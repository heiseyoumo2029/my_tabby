/** Read-only Linux probe, run without a PTY on the interactive SSH transport. */
export const WORKING_DIRECTORY_PROBE = String.raw`
import os, sys, json, subprocess

def result(**values):
    print('TABBY_CWD:' + json.dumps(values))
    sys.exit(0)

def stat(pid):
    try:
        with open('/proc/%s/stat' % pid, 'rb') as file:
            text = file.read()
        end = text.rindex(b')')
        fields = text[end+2:].split()
        return dict(pid=int(pid), name=os.fsdecode(text[text.index(b'(')+1:end]),
                    ppid=int(fields[1]), pgrp=int(fields[2]), sid=int(fields[3]),
                    tty=int(fields[4]), fg=int(fields[5]), start=int(fields[19]))
    except (OSError, ValueError, IndexError):
        return None

if not os.path.isdir('/proc/self'):
    result(error='Linux /proc is unavailable', allowReport=True)
ancestor = os.getppid()
while ancestor > 1:
    current = stat(ancestor)
    if not current: break
    if current['name'].startswith('sshd') and not current['tty']: break
    ancestor = current['ppid']
else:
    current = None
if not current or not current['name'].startswith('sshd'):
    result(error='SSH connection process is unavailable', allowReport=True)

processes = {}
for name in os.listdir('/proc'):
    if name.isdigit():
        p = stat(name)
        if p: processes[p['pid']] = p

# Only outer SSH login sessions, not PTYs created inside tmux, sudo or screen.
def outer_session(p):
    if p['pid'] != p['sid'] or not p['tty']: return False
    parent = p['ppid']
    while parent in processes and parent != ancestor:
        proc = processes[parent]
        if proc['tty'] or parent == proc['ppid']: return False
        parent = proc['ppid']
    return parent == ancestor

sessions = {'%s:%s:%s' % (p['sid'], p['start'], p['tty']): p
            for p in processes.values() if outer_session(p)}
op, key, executable, socket = sys.argv[1:5]
if op == 'list':
    result(sessions=list(sessions))
if key:
    if key not in sessions:
        result(error='The terminal bound to this SSH tab is no longer available', allowReport=True)
    session = sessions[key]
elif len(sessions) == 1:
    session = next(iter(sessions.values()))
else:
    result(error='Expected one SSH login terminal; found %d' % len(sessions), allowReport=True)

# stat.tty_nr identifies the controlling terminal even when stdin is redirected.
p = processes.get(session['fg'])
if not p or p['sid'] != session['sid'] or p['tty'] != session['tty']:
    result(error='Foreground process of this SSH terminal is unavailable', allowReport=True)
if p['name'].startswith('tmux'):
    command = [executable or 'tmux'] + (['-S', socket] if socket else [])
    try:
        # Match the actual client rather than the server's most recent session.
        clients = subprocess.check_output(command + ['list-clients', '-F', '#{client_pid} #{client_tty} #{session_id}'], stderr=subprocess.PIPE, timeout=3).decode().splitlines()
        matches = [line.split(' ') for line in clients if line.startswith(str(p['pid']) + ' ')]
        if len(matches) != 1:
            result(error='Current tmux client was not found on the configured socket')
        _, tty, target = matches[0]
        output = subprocess.check_output(command + ['display-message', '-p', '-c', tty, '-t', target + ':', '#{pane_id}\t#{pane_current_path}'], stderr=subprocess.PIPE, timeout=3).decode().rstrip('\n')
        pane, cwd = output.split('\t', 1)
        if not pane.startswith('%') or not pane[1:].isdigit() or not cwd.startswith('/'):
            result(error='Invalid tmux pane or directory')
        result(path=cwd)
    except subprocess.CalledProcessError as e:
        result(error='tmux: ' + e.stderr.decode(errors='replace').strip()[:256])
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        result(error='Could not inspect current tmux client: ' + str(e))
elif p['name'].lstrip('-') in ('bash', 'zsh', 'sh', 'dash', 'ksh', 'ksh93', 'mksh', 'fish', 'ash', 'csh', 'tcsh'):
    try:
        cwd = os.readlink('/proc/%s/cwd' % p['pid'])
        if not cwd.startswith('/') or cwd.endswith(' (deleted)'): result(error='Shell directory is unavailable')
        result(path=cwd)
    except OSError:
        result(error='Shell directory is not accessible', allowReport=True)
else:
    result(error='Foreground program is not a shell or tmux client')
`
