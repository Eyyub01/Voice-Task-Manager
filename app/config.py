from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str
    openai_realtime_url: str = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28"

    class Config:
        env_file = ".env"

settings = Settings()