"""Read/write an existing regular file relative to pinned, no-follow directory FDs.

Node has no portable openat API. Python's dir_fd support provides the same
capability boundary on macOS and Linux without resolving attacker-owned symlinks.
"""
import os
import stat
import sys


def main():
    operation, root, relative = sys.argv[1:]
    parts = relative.split('/')
    if operation not in ('read', 'write') or any(
        part in ('', '.', '..') or part.lower() == '.git' or '\\' in part
        for part in parts
    ):
        raise ValueError('Unsafe repository path')
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=directory)
            os.close(directory)
            directory = child
        flags = os.O_RDONLY if operation == 'read' else os.O_WRONLY
        fd = os.open(parts[-1], flags | os.O_NOFOLLOW, dir_fd=directory)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError('Conflict target must be a regular file with a single hard link')
            if operation == 'read':
                with os.fdopen(fd, 'rb', closefd=False) as source:
                    sys.stdout.buffer.write(source.read())
            else:
                # Truncate only after validating the opened target. No path is
                # reopened between validation and the write.
                content = sys.stdin.buffer.read()
                os.ftruncate(fd, 0)
                with os.fdopen(fd, 'wb', closefd=False) as target:
                    target.write(content)
        finally:
            os.close(fd)
    finally:
        os.close(directory)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('Unsafe repository path: ' + str(error), file=sys.stderr)
        sys.exit(1)
