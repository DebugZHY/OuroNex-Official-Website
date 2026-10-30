import random
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


class Command(BaseCommand):
    help = 'Create deterministic synthetic token usage records for existing users.'

    def add_arguments(self, parser):
        parser.add_argument('--username', help='Seed only this existing username.')
        parser.add_argument('--days', type=int, default=30, help='Number of recent days, including today.')

    def handle(self, *args, **options):
        days = options['days']
        if not 1 <= days <= 365:
            raise CommandError('--days must be between 1 and 365.')
        users = User.objects.filter(is_active=True).order_by('id')
        if options['username']:
            users = users.filter(username=options['username'])
        if not users.exists():
            raise CommandError('No matching active user exists; no users were created.')

        models = ('sida-pro', 'sida-fast')
        sessions = (
            ('drawing-review', 'Drawing compliance review'),
            ('frame-optimization', 'Frame optimization'),
            ('quantity-takeoff', 'Quantity takeoff'),
        )
        today = timezone.localdate()
        total = 0
        for user in users:
            rng = random.Random(user.pk * 1009)
            for offset in range(days - 1, -1, -1):
                day = today - timedelta(days=offset)
                for model_index, model in enumerate(models):
                    for session_index, (session_id, title) in enumerate(sessions):
                        activity = 1 + ((offset + model_index + session_index) % 4)
                        input_tokens = rng.randint(700, 5200) * activity
                        output_tokens = rng.randint(180, 1300) * activity
                        cache_write = rng.randint(120, 800) * activity
                        cache_read = rng.randint(900, 6200) * activity
                        user.token_usage_records.update_or_create(
                            source='demo',
                            day=day,
                            model=model,
                            session_id=f'{session_id}-{user.pk:03d}',
                            defaults={
                                'title': title,
                                'calls': activity + model_index + session_index,
                                'input_tokens': input_tokens,
                                'output_tokens': output_tokens,
                                'cache_write_tokens': cache_write,
                                'cache_read_tokens': cache_read,
                            },
                        )
                        total += 1
        if options['verbosity']:
            self.stdout.write(self.style.SUCCESS(
                f'Upserted {total} synthetic usage operations for {users.count()} existing user(s).'
            ))
