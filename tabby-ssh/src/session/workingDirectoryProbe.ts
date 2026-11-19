/** Read-only Linux probe run in a separate exec channel of the same SSH connection. */
export const WORKING_DIRECTORY_PROBE = String.raw`
import os, sys, json, subprocess

def fail(reason):
    print(json.dumps({'error': reason}))
    sys.exit(0)

def stat(pid):
    try:
        text = open('/proc/%s/stat' % pid).read()
        name = text[text.index('(')+1:text.rindex(')')]
        fields = text[text.rindex(')')+2:].split()
        return {'pid': int(pid), 'name': name, 'ppid': int(fields[1]), 'pgrp': int(fields[2]), 'tpgid': int(fields[5])}
    except (OSError, ValueError, IndexError):
        return None

if not os.path.isdir('/proc/self'):
    fail('Linux /proc is unavailable')
ancestor = os.getppid()
root = None
while ancestor > 1:
    current = stat(ancestor)
    if not current: break
    if current['name'].startswith('sshd'):
        root = ancestor
        break
    ancestor = current['ppid']
if root is None:
    fail('SSH connection process is unavailable')
processes = {}
for name in os.listdir('/proc'):
    if name.isdigit():
        p = stat(name)
        if p: processes[p['pid']] = p

def within(pid):
    seen = set()
    while pid in processes and pid not in seen:
        if pid == root: return True
        seen.add(pid)
        pid = processes[pid]['ppid']
    return False

terminals = {}
for p in processes.values():
    if not within(p['pid']): continue
    try:
        tty = os.readlink('/proc/%s/fd/0' % p['pid'])
    except OSError:
        continue
    if tty.startswith('/dev/pts/') and p['tpgid'] > 0 and p['pgrp'] == p['tpgid']:
        terminals.setdefault(tty, []).append(p)
if len(terminals) != 1:
    fail('SSH terminal is unavailable or ambiguous')
tty, foreground = next(iter(terminals.items()))
leaders = [p for p in foreground if p['pid'] == p['pgrp']]
if len(leaders) != 1:
    fail('Foreground process is unavailable or ambiguous')
p = leaders[0]
if p['name'].startswith('tmux'):
    executable, socket = sys.argv[1:3]
    command = [executable or 'tmux'] + (['-S', socket] if socket else [])
    try:
        clients = subprocess.check_output(command + ['list-clients', '-F', '#{client_tty}'], stderr=subprocess.STDOUT, timeout=3).decode('utf-8').splitlines()
        if clients.count(tty) != 1: fail('Current tmux client was not found')
        output = subprocess.check_output(command + ['display-message', '-p', '-c', tty, '#{pane_id}\t#{pane_current_path}'], stderr=subprocess.STDOUT, timeout=3).decode('utf-8').rstrip('\n')
        pane, cwd = output.split('\t', 1)
        if not pane.startswith('%') or not pane[1:].isdigit(): fail('Invalid tmux pane')
        if not cwd.startswith('/'): fail('Invalid tmux directory')
        print(json.dumps({'path': cwd, 'kind': 'tmux', 'pane': pane}))
    except (OSError, subprocess.SubprocessError, ValueError):
        fail('Could not inspect current tmux client')
elif p['name'].lstrip('-') in ('bash', 'zsh', 'sh', 'dash', 'ksh', 'fish', 'ash'):
    try:
        cwd = os.readlink('/proc/%s/cwd' % p['pid'])
        if not cwd.startswith('/') or cwd.endswith(' (deleted)'): fail('Shell directory is unavailable')
        print(json.dumps({'path': cwd, 'kind': 'shell'}))
    except OSError:
        fail('Shell directory is not accessible')
else:
    fail('Foreground program is not a shell or tmux client')
`
