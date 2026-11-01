from django.db import models


class AgentSystem(models.Model):
    """A saved agent system of the constructor (ARCHIE-342).

    `spec` is an AgentSystemSpec; the agent validates and runs it, Django keeps
    it as the user saved it. `schedule_job_id` is the cron job on the agent
    while the system is scheduled.
    """

    title = models.CharField(max_length=120)
    spec = models.JSONField()
    task = models.TextField(blank=True, default="")
    demo_mode = models.BooleanField(default=True)
    schedule_job_id = models.CharField(max_length=32, blank=True, default="")
    revision = models.PositiveIntegerField(default=1)
    updated_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.title} ({self.spec.get('topology', '?')})"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "spec": self.spec,
            "task": self.task,
            "demo_mode": self.demo_mode,
            "schedule_job_id": self.schedule_job_id,
            "revision": self.revision,
            "updated_by": self.updated_by,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
