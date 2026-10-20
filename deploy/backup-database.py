#!/usr/bin/env python3
"""Back up the VPS database once per Baghdad day; retain seven calendar days."""

import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from zoneinfo import ZoneInfo


BACKUP_ROOT = Path('/var/backups/storylens')
CONTAINER = 'raseen-staging-postgres-1'
DATABASE = 'storylens'
TIMEZONE = ZoneInfo('Asia/Baghdad')


def prune_backups(root: Path, today: dt.date) -> None:
    cutoff = today - dt.timedelta(days=6)
    for entry in root.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            continue
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', entry.name):
            continue
        try:
            day = dt.date.fromisoformat(entry.name)
        except ValueError:
            continue
        if day < cutoff and (entry / 'metadata.json').is_file():
            shutil.rmtree(entry)
            print(f'Removed expired backup: {entry.name}', flush=True)


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def main() -> None:
    os.umask(0o077)
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (BACKUP_ROOT / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = dt.datetime.now(TIMEZONE)
        day = now.date()
        destination = BACKUP_ROOT / day.isoformat()
        if destination.exists():
            metadata = json.loads((destination / 'metadata.json').read_text())
            if digest(destination / 'storylens.dump') != metadata['sha256']:
                raise RuntimeError('Existing daily backup checksum failed; keeping all backups')
            print(f'Backup already exists and checksum passed: {destination}', flush=True)
            prune_backups(BACKUP_ROOT, day)
            return

        temporary = Path(tempfile.mkdtemp(prefix=f'.{day.isoformat()}-', dir=BACKUP_ROOT))
        try:
            archive = temporary / 'storylens.dump'
            with archive.open('wb') as stream:
                subprocess.run(
                    ['docker', 'exec', CONTAINER, 'pg_dump', '-U', DATABASE,
                     '-d', DATABASE, '--format=custom', '--no-owner', '--no-acl',
                     '--lock-wait-timeout=30s'],
                    stdout=stream, check=True, timeout=600,
                )
                stream.flush()
                os.fsync(stream.fileno())
            with archive.open('rb') as stream, (temporary / 'manifest.txt').open('w') as manifest:
                subprocess.run(
                    ['docker', 'exec', '-i', CONTAINER, 'pg_restore', '--list'],
                    stdin=stream, stdout=manifest, check=True, timeout=60,
                )
            checksum = digest(archive)
            (temporary / 'storylens.dump.sha256').write_text(f'{checksum}  storylens.dump\n')
            (temporary / 'metadata.json').write_text(json.dumps({
                'database': DATABASE, 'container': CONTAINER,
                'created_at': now.isoformat(), 'timezone': str(TIMEZONE),
                'format': 'PostgreSQL custom', 'bytes': archive.stat().st_size,
                'sha256': checksum, 'retention_calendar_days': 7,
            }, indent=2) + '\n')
            temporary.rename(destination)
            print(f'Backup complete: {destination} ({archive.name}, SHA256 {checksum})', flush=True)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        # Never prune old backups until the new archive has completed and passed inspection.
        prune_backups(BACKUP_ROOT, day)


if __name__ == '__main__':
    main()
