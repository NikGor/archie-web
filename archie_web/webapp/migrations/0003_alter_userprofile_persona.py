# ARCHIE-249: Marcus persona

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("webapp", "0002_alter_userprofile_persona"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="persona",
            field=models.CharField(
                choices=[
                    ("business", "Business"),
                    ("bro", "Bro"),
                    ("flirty", "Flirty"),
                    ("futurebot", "Futurebot"),
                    ("butler", "Butler"),
                    ("marcus", "Marcus"),
                ],
                default="personal",
                max_length=20,
            ),
        ),
    ]
