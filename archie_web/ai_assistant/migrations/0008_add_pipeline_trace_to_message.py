from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ai_assistant", "0007_add_pipeline_steps_to_message"),
    ]
    operations = [
        migrations.AddField(
            model_name="message",
            name="pipeline_trace",
            field=models.JSONField(null=True, blank=True),
        ),
    ]
