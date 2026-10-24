from django.db import models


class SwarmEvent(models.Model):
    """One swarm chat message (archie_shared.swarm.models.SwarmMessage), ARCHIE-281.

    The agent keeps only the last messages in Redis and clears them on Stop;
    this journal keeps the full history for the daily swarm audit.
    """

    message_id = models.CharField(max_length=64, unique=True)
    run_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(db_index=True)
    sender = models.CharField(max_length=32, db_index=True)
    kind = models.CharField(max_length=16, db_index=True)
    text = models.TextField()
    mentions = models.JSONField(default=list)
    reply_to = models.CharField(max_length=64, blank=True, default="")
    depth = models.PositiveIntegerField(default=0)
    importance = models.CharField(max_length=8, blank=True, default="")
    round = models.PositiveIntegerField(null=True, blank=True)
    actions = models.JSONField(default=list)
    usage = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "message_id"]

    def __str__(self) -> str:
        return f"{self.message_id} {self.sender} [{self.kind}]"
