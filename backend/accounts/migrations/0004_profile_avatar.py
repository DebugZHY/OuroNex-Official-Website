from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_tokenusagerecord'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='avatar_data',
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='profile',
            name='avatar_content_type',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='profile',
            name='avatar_updated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
