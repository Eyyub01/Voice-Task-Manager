from sqlalchemy.orm import Session
from app import models
from datetime import datetime

def create_task(db: Session, title: str, due_datetime: datetime):
    db_task = models.Task(title=title, due_datetime=due_datetime)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

def get_all_tasks(db: Session):
    return db.query(models.Task).all()

def update_task_details(db: Session, task_id: int, updates: dict):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        return None
    
    for key, value in updates.items():
        if hasattr(db_task, key) and value is not None:
            setattr(db_task, key, value)
            
    db.commit()
    db.refresh(db_task)
    return db_task

def delete_task_by_id(db: Session, task_id: int):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        return False
    
    db.delete(db_task)
    db.commit()
    return True