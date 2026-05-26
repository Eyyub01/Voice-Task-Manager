from datetime import datetime
from sqlalchemy.orm import Session
from app import crud

TASK_TOOLS = [ 
    {
        "type": "function",
        "name": "create_task",
        "description": "Creates a new task. Interpret relative terms like 'tomorrow' using the reference time in the system prompt.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The description of the task."},
                "due_datetime": {"type": "string", "description": "ISO 8601 string calculated by the model (e.g., '2026-05-27T10:00:00')."}
            },
            "required": ["title", "due_datetime"]
        }
    },
    {
        "type": "function",
        "name": "get_all_tasks",
        "description": "Retrieves all tasks currently tracked in the system.",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "type": "function",
        "name": "update_task",
        "description": "Updates fields of an existing task by its database ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "Target task database primary key ID."},
                "title": {"type": "string"},
                "due_datetime": {"type": "string", "description": "New ISO 8601 string if the execution time shifted."},
                "status": {"type": "string", "enum": ["pending", "completed"]}
            },
            "required": ["task_id"]
        }
    },
    {
        "type": "function",
        "name": "delete_task",
        "description": "Permanently deletes a task. CRITICAL: Only invoke this if the user explicitly confirmed deletion.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"}
            },
            "required": ["task_id"]
        }
    }
]

def handle_agent_tool_call(db: Session, name: str, args: dict) -> dict:
    try:
        if name == "create_task":
            dt = datetime.fromisoformat(args["due_datetime"])
            task = crud.create_task(db, title=args["title"], due_datetime=dt)
            return {"status": "success", "task_id": task.id}

        elif name == "get_all_tasks":
            tasks = crud.get_all_tasks(db)
            return {
                "status": "success",
                "tasks": [
                    {"id": t.id, "title": t.title, "due_datetime": t.due_datetime.isoformat(), "status": t.status}
                    for t in tasks
                ]
            }

        elif name == "update_task":
            task_id = args["task_id"]
            payload = {k: v for k, v in args.items() if k != "task_id"}
            if "due_datetime" in payload and payload["due_datetime"]:
                payload["due_datetime"] = datetime.fromisoformat(payload["due_datetime"])
            
            updated = crud.update_task_details(db, task_id=task_id, updates=payload)
            if updated:
                return {"status": "success", "task_id": task_id}
            return {"status": "error", "message": "Task not found"}

        elif name == "delete_task":
            task_id = args["task_id"]
            if crud.delete_task_by_id(db, task_id=task_id):
                return {"status": "success", "task_id": task_id}
            return {"status": "error", "message": "Task not found"}

        return {"status": "error", "message": f"Unknown tool: {name}"}

    except Exception as e:
        return {"status": "error", "message": str(e)}