from django.db import models

RUN_STATUSES = ["queued", "running", "completed", "cancelled", "failed"]
ATTEMPT_STATUSES = ["passed", "failed", "error"]


class EvalRun(models.Model):
    """One prompt eval run (archie_shared.evals.models.EvalRunInfo)."""

    run_id = models.CharField(max_length=32, unique=True)
    status = models.CharField(
        max_length=16,
        choices=[(status, status) for status in RUN_STATUSES],
    )
    reason = models.TextField()
    jira_key = models.CharField(max_length=32, blank=True, default="")
    triggered_by = models.CharField(max_length=16)
    model_names = models.JSONField(default=list)
    repeats = models.PositiveSmallIntegerField(default=1)
    judge_model = models.CharField(max_length=128, blank=True, default="")
    request = models.JSONField(default=dict)
    case_ids = models.JSONField(default=list)
    cases = models.JSONField(
        default=list,
        help_text="EvalCaseInfo snapshots at run time",
    )
    git_sha = models.CharField(max_length=64, blank=True, default="")
    prompt_hashes = models.JSONField(
        default=dict,
        help_text="Empty for runs imported from old JSON files",
    )
    total_attempts = models.PositiveIntegerField(default=0)
    done_attempts = models.PositiveIntegerField(default=0)
    passed = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    errors = models.PositiveIntegerField(default=0)
    total_tokens = models.PositiveBigIntegerField(default=0)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.run_id} ({self.status}): {self.reason}"


class EvalCaseResult(models.Model):
    """One attempt of one case on one model (archie_shared.evals.models.EvalCaseResult)."""

    run = models.ForeignKey(
        EvalRun,
        on_delete=models.CASCADE,
        related_name="results",
    )
    case_id = models.CharField(max_length=128)
    model = models.CharField(max_length=128)
    attempt = models.PositiveSmallIntegerField()
    status = models.CharField(
        max_length=8,
        choices=[(status, status) for status in ATTEMPT_STATUSES],
    )
    failures = models.JSONField(default=list)
    error = models.TextField(blank=True, default="")
    stage1_ms = models.PositiveIntegerField(null=True, blank=True)
    stage2_ms = models.PositiveIntegerField(null=True, blank=True)
    stage3_ms = models.PositiveIntegerField(null=True, blank=True)
    total_ms = models.PositiveIntegerField(null=True, blank=True)
    total_tokens = models.PositiveIntegerField(null=True, blank=True)
    ui_items_count = models.PositiveSmallIntegerField(null=True, blank=True)
    judge = models.JSONField(null=True, blank=True)
    output_json = models.TextField(blank=True, default="")
    finished_at = models.DateTimeField()

    class Meta:
        ordering = ["finished_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["run", "case_id", "model", "attempt"],
                name="unique_eval_attempt",
            )
        ]
        indexes = [models.Index(fields=["case_id", "model"])]

    def __str__(self) -> str:
        return f"{self.case_id} {self.model} #{self.attempt}: {self.status}"


class EvalCase(models.Model):
    """One eval case (agent EvalCaseDraft); the agent validates it before save."""

    case_id = models.CharField(max_length=128, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField()
    suite = models.CharField(max_length=64)
    tags = models.JSONField(default=list)
    rules = models.JSONField(
        default=list,
        help_text="Prompt spec rules the case protects, as 'spec:rule_id' (ARCHIE-213)",
    )
    extra_prompts = models.JSONField(default=list)
    prompts = models.JSONField(
        default=list,
        help_text="All prompts the case tests, as normalized by the agent",
    )
    input = models.TextField()
    response_format = models.CharField(max_length=32)
    stage = models.CharField(max_length=16)
    judge = models.BooleanField(default=False)
    expect = models.JSONField(default=dict)
    enabled = models.BooleanField(default=True)
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        ordering = ["suite", "case_id"]

    def __str__(self) -> str:
        return f"{self.case_id} r{self.revision}"

    def to_draft(self) -> dict:
        return {
            "id": self.case_id,
            "name": self.name,
            "description": self.description,
            "suite": self.suite,
            "extra_prompts": self.extra_prompts,
            "tags": self.tags,
            "rules": self.rules,
            "input": self.input,
            "response_format": self.response_format,
            "stage": self.stage,
            "judge": self.judge,
            "expect": self.expect,
        }

    def to_info(self) -> dict:
        """archie_shared EvalCaseInfo shape."""
        info = {
            key: value
            for key, value in self.to_draft().items()
            if key != "extra_prompts"
        }
        return {**info, "prompts": self.prompts}


class EvalCaseRevision(models.Model):
    """A saved version of a case; revision 1 is the first save."""

    case = models.ForeignKey(
        EvalCase,
        on_delete=models.CASCADE,
        related_name="revisions",
    )
    revision = models.PositiveIntegerField()
    data = models.JSONField(help_text="EvalCaseDraft at this revision")
    enabled = models.BooleanField(default=True)
    author = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-revision"]
        constraints = [
            models.UniqueConstraint(
                fields=["case", "revision"],
                name="unique_eval_case_revision",
            )
        ]
