import json
import asyncio
from websockets.asyncio.client import connect as ws_connect
from fastapi import FastAPI, WebSocket, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import engine, Base, get_db
from app.agent import TASK_TOOLS, handle_agent_tool_call
from app.config import settings

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Voice Task Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_REALTIME_URL = settings.openai_realtime_url
OPENAI_API_KEY = settings.openai_api_key


@app.get("/ping")
def health_check():
    return {"status": "online"}


@app.get("/tasks")
def get_tasks(db: Session = Depends(get_db)):
    from app import crud
    tasks = crud.get_all_tasks(db)
    return [
        {
            "id": t.id,
            "title": t.title,
            "due_datetime": t.due_datetime.isoformat(),
            "status": t.status,
        }
        for t in tasks
    ]


@app.websocket("/media-stream")
async def handle_media_stream(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()

    if not OPENAI_API_KEY:
        await websocket.close(code=4001, reason="Missing OpenAI API Key")
        return

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }

    try:
        async with ws_connect(OPENAI_REALTIME_URL, additional_headers=headers) as ai_ws:
            await initialize_ai_session(ai_ws)

            async def forward_ai_to_client():
                try:
                    async for response in ai_ws:
                        data = json.loads(response)
                        event_type = data.get("type", "")

                        if event_type == "response.function_call_arguments.done":
                            tool_result = await execute_and_reply_tool(ai_ws, db, data)
                            await websocket.send_text(json.dumps({
                                "type": "task_list_updated",
                                "tool": data.get("name"),
                                "result": tool_result,
                            }))
                        elif event_type == "error":
                            if data.get("error", {}).get("code") != "response_cancel_not_active":
                                print(f"[OpenAI ERROR] {json.dumps(data)}")
                            await websocket.send_text(response)
                        else:
                            await websocket.send_text(response)
                except Exception as e:
                    print(f"OpenAI connection disconnected: {e}")

            ai_listener_task = asyncio.create_task(forward_ai_to_client())

            try:
                while True:
                    message = await websocket.receive_text()
                    await ai_ws.send(message)
            except Exception:
                pass
            finally:
                ai_listener_task.cancel()

    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = f"Crash: {type(e).__name__} - {str(e)}"
        try:
            await websocket.send_text(error_msg)
            await websocket.close(code=1011, reason="Backend Exception")
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


async def initialize_ai_session(ai_ws):
    from datetime import datetime
    current_time = datetime.now().strftime("%A, %B %d %Y, %I:%M %p")

    instructions = f"""You are a friendly, concise voice assistant that helps users manage their tasks.
Current date and time: {current_time}.

CORE RULES:
- Always respond using voice (audio). Keep responses short and natural — 1-3 sentences max.
- Never list raw data. Summarize conversationally. E.g. "You have a gym session at 7 AM and a team sync at 9 AM."
- Maintain full conversation context. When the user says "the previous one", "that task", "the second one", etc., resolve it from the conversation history.
- Interpret relative time naturally: "tomorrow morning" = next day 9 AM, "evening" = 6 PM, "afternoon" = 2 PM, "tonight" = 8 PM.
- For semantic task references like "my evening workout" or "the LinkedIn post", match by meaning, not exact title.

CRUD RULES:
- CREATE: Confirm after creating. E.g. "Done, I've added gym at 7 AM tomorrow."
- READ: Summarize naturally. Group by time of day when listing multiple tasks.
- UPDATE: Confirm the change. E.g. "Updated — LinkedIn post moved to 6 PM."
- DELETE: ALWAYS ask for confirmation before deleting. E.g. "Just to confirm — delete the LinkedIn post at 5 PM?" Wait for "yes" before calling delete_task.
  - If the task reference is ambiguous, ask a clarifying question first.
  - Only call delete_task after the user explicitly confirms.

MULTIPLE TASKS: If the user asks to create several tasks at once, create them all and confirm together.

FAILURE HANDLING: If a tool call fails or a task isn't found, tell the user naturally and ask for clarification."""

    session_update = {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "model": "gpt-realtime-2025-08-28",
            "instructions": instructions,
            "tools": TASK_TOOLS,
            "tool_choice": "auto",
        },
    }
    await ai_ws.send(json.dumps(session_update))


async def execute_and_reply_tool(ai_ws, db: Session, data: dict) -> dict:
    call_id = data["call_id"]
    name = data["name"]
    args = json.loads(data["arguments"])

    result = handle_agent_tool_call(db, name, args)

    tool_output = {
        "type": "conversation.item.create",
        "item": {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(result),
        },
    }
    await ai_ws.send(json.dumps(tool_output))
    await ai_ws.send(json.dumps({"type": "response.create"}))
    return result
