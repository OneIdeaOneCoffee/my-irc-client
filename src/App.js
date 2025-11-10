import React, { useState, useRef } from 'react';
import { Send, Power, Radio, AlertCircle } from 'lucide-react';

// ============================================================================
// 1. BUFFER MANAGER - Resolve fragmentação de WebSocket
// ============================================================================
class BufferManager {
  constructor() {
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = [];

    while (this.buffer.includes('\r\n')) {
      const idx = this.buffer.indexOf('\r\n');
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 2);
    }

    return lines;
  }

  clear() {
    this.buffer = '';
  }
}

// ============================================================================
// 2. IRC PARSER - Converte linha raw em objeto estruturado
// ============================================================================
class IRCParser {
  static parse(line) {
    let prefix = null;
    let command = null;
    let params = [];
    let trailing = null;

    let pos = 0;

    // Parse prefix (:nick!user@host)
    if (line[0] === ':') {
      const spaceIdx = line.indexOf(' ');
      prefix = line.slice(1, spaceIdx);
      pos = spaceIdx + 1;
    }

    // Parse command (PING, PRIVMSG, 001, etc.)
    const nextSpace = line.indexOf(' ', pos);
    if (nextSpace === -1) {
      command = line.slice(pos).trim();
      return { raw: line, prefix, command, params, trailing };
    }

    command = line.slice(pos, nextSpace);
    pos = nextSpace + 1;

    // Parse params e trailing (:texto com espaços)
    const rest = line.slice(pos);
    if (rest.includes(' :')) {
      const trailingIdx = rest.indexOf(' :');
      const beforeTrailing = rest.slice(0, trailingIdx);
      trailing = rest.slice(trailingIdx + 2);
      params = beforeTrailing.split(' ').filter(Boolean);
    } else if (rest[0] === ':') {
      trailing = rest.slice(1);
    } else {
      params = rest.split(' ').filter(Boolean);
    }

    return { raw: line, prefix, command, params, trailing };
  }
}

// ============================================================================
// 3. IRC CLIENT - Engine principal (stateless)
// ============================================================================
class IRCClient {
  constructor() {
    this.ws = null;
    this.buffer = new BufferManager();
    this.listeners = new Map();
    this.connectionState = 'disconnected'; // apenas para UI, não afeta lógica
  }

  // Event emitter pattern
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }

  connect(url, nick, user, realname, password = null) {
    this.connectionState = 'connecting';
    this.emit('state', { state: 'connecting' });

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connectionState = 'registering';
      this.emit('state', { state: 'registering' });
      this.emit('debug', { msg: 'WebSocket aberto, iniciando handshake IRC' });

      // Handshake IRC
      if (password) {
        this.send(`PASS ${password}`);
      }
      this.send(`NICK ${nick}`);
      this.send(`USER ${user} 0 * :${realname}`);
    });

    this.ws.addEventListener('message', (evt) => {
      const lines = this.buffer.push(evt.data);

      // Se buffer não retornou linhas, trata como line-mode (sem \r\n)
      const processedLines = lines.length > 0 ? lines :
        (evt.data.trim() ? [evt.data.trim()] : []);

      processedLines.forEach(line => {
        const msg = IRCParser.parse(line);

        // Auto-responde PING (resolve problema 2)
        if (msg.command === 'PING') {
          this.send(`PONG ${msg.trailing || msg.params[0]}`);
          this.emit('ping', msg);
          return;
        }

        // Detecta conexão estabelecida (resolve problema 1)
        if (msg.command === '001') {
          this.connectionState = 'connected';
          this.emit('state', { state: 'connected' });
          this.emit('registered', msg);
          return;
        }

        // Emite eventos específicos
        if (msg.command === 'PRIVMSG') {
          const target = msg.params[0];
          const sender = msg.prefix ? msg.prefix.split('!')[0] : 'server';
          this.emit('message', {
            from: sender,
            to: target,
            text: msg.trailing,
            isChannel: target.startsWith('#'),
            raw: msg
          });
        } else if (msg.command === 'JOIN') {
          const nick = msg.prefix ? msg.prefix.split('!')[0] : '';
          const channel = msg.trailing || msg.params[0];
          this.emit('join', { nick, channel, raw: msg });
        } else if (msg.command === 'PART') {
          const nick = msg.prefix ? msg.prefix.split('!')[0] : '';
          const channel = msg.params[0];
          this.emit('part', { nick, channel, reason: msg.trailing, raw: msg });
        } else if (msg.command === '353') {
          // NAMES list
          const channel = msg.params[2];
          const users = msg.trailing ? msg.trailing.split(' ') : [];
          this.emit('names', { channel, users, raw: msg });
        }

        // Sempre emite raw para debugging
        this.emit('raw', msg);
      });
    });

    this.ws.addEventListener('close', (evt) => {
      this.connectionState = 'disconnected';
      this.buffer.clear();
      this.emit('state', { state: 'disconnected', code: evt.code });
    });

    this.ws.addEventListener('error', (err) => {
      // WebSocket error events não têm .message, só .type
      this.emit('error', {
        type: err.type,
        timestamp: Date.now(),
        readyState: this.ws.readyState,
        url: url
      });
    });
  }

  send(line) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(line + '\r\n');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  // Comandos de conveniência
  join(channel) {
    this.send(`JOIN ${channel}`);
  }

  part(channel, reason = '') {
    this.send(`PART ${channel}${reason ? ' :' + reason : ''}`);
  }

  privmsg(target, text) {
    this.send(`PRIVMSG ${target} :${text}`);
  }

  quit(reason = 'Leaving') {
    this.send(`QUIT :${reason}`);
    setTimeout(() => this.disconnect(), 500);
  }

  names(channel) {
    this.send(`NAMES ${channel}`);
  }
}

// ============================================================================
// UI DE TESTE (melhorada)
// ============================================================================
export default function IRCEngineDemo() {
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState('disconnected');
  const [config, setConfig] = useState({
    url: 'wss://testnet.ergo.chat',
    nick: 'TestBot' + Math.floor(Math.random() * 9999),
    user: 'testuser',
    realname: 'IRC Test Bot'
  });

  const [commandInput, setCommandInput] = useState('');

  const wsServers = [
    { name: 'UnrealIRCd Demo', url: 'wss://irc.unrealircd.org:443', note: 'WebSocket nativo funcionando ✅' },
    { name: 'Ergo Testnet', url: 'wss://testnet.ergo.chat', note: 'Pode estar offline' },
  ];

  const clientRef = useRef(null);

  const addLog = (type, data) => {
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      type,
      data
    }].slice(-50)); // mantém últimas 50 linhas
  };

  const handleConnect = () => {
    const client = new IRCClient();
    clientRef.current = client;

    client.on('state', (data) => {
      setState(data.state);
      addLog('state', `Estado: ${data.state}`);
    });

    client.on('debug', (data) => {
      addLog('debug', data.msg);
    });

    client.on('registered', () => {
      addLog('success', 'Conectado! Agora você pode enviar JOIN #canal');
    });

    client.on('ping', () => {
      addLog('ping', 'PING recebido e respondido automaticamente');
    });

    client.on('message', (msg) => {
      const prefix = msg.isChannel ? `[${msg.to}]` : `[PM]`;
      addLog('message', `${prefix} <${msg.from}> ${msg.text}`);
    });

    client.on('join', (data) => {
      addLog('join', `${data.nick} entrou em ${data.channel}`);
    });

    client.on('part', (data) => {
      const reason = data.reason ? ` (${data.reason})` : '';
      addLog('part', `${data.nick} saiu de ${data.channel}${reason}`);
    });

    client.on('names', (data) => {
      addLog('names', `Usuários em ${data.channel}: ${data.users.join(', ')}`);
    });

    client.on('raw', (msg) => {
      addLog('raw', msg.raw);
    });

    client.on('error', (data) => {
      addLog('error', `WebSocket Error: ${data.type} | ReadyState: ${data.readyState} | URL: ${data.url}`);
    });

    client.connect(
      config.url,
      config.nick,
      config.user,
      config.realname
    );
  };

  const handleDisconnect = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  };

  const handleCommand = (cmd) => {
    if (!clientRef.current || state !== 'connected') {
      addLog('error', 'Não conectado!');
      return;
    }

    clientRef.current.send(cmd);
    addLog('sent', `→ ${cmd}`);
  };

  const handleSendCommand = () => {
    if (commandInput.trim()) {
      handleCommand(commandInput);
      setCommandInput('');
    }
  };

  const stateColors = {
    disconnected: 'text-gray-400',
    connecting: 'text-yellow-500',
    registering: 'text-blue-500',
    connected: 'text-green-500'
  };

  // Novos estilos
  const sectionBg = "bg-white/90 dark:bg-gray-950/95";
  const cardBg = "bg-white/80 dark:bg-gray-900/85";
  const heading = "font-bold text-lg md:text-2xl text-gray-900 dark:text-gray-100";
  const subheading = "font-medium text-base text-gray-700 dark:text-gray-300";
  const divider = "border-b border-gray-300 dark:border-gray-800 my-6";
  const labelClass = "block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 tracking-wide";
  const inputClass = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-3 transition focus:outline-none focus:ring-2 focus:ring-blue-500";
  const buttonPrimary = "px-4 py-2 rounded-lg font-bold bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-400 transition disabled:bg-gray-300 disabled:text-gray-500 flex items-center gap-2 text-sm";
  const buttonSecondary = "px-4 py-2 rounded-lg font-bold bg-gray-200 text-gray-900 hover:bg-gray-300 transition disabled:bg-gray-100 flex items-center gap-2 text-sm";
  const buttonDanger = "px-4 py-2 rounded-lg font-bold bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-red-400 transition flex items-center gap-2 text-sm";
  const consoleTypes = {
    error: 'bg-red-50 text-red-900 border-l-4 border-red-500',
    success: 'bg-green-50 text-green-900 border-l-4 border-green-500',
    ping: 'bg-yellow-50 text-yellow-900 border-l-4 border-yellow-500',
    message: 'bg-cyan-50 text-cyan-900 border-l-4 border-cyan-500',
    join: 'bg-green-100 text-green-900 border-l-4 border-green-400',
    part: 'bg-orange-50 text-orange-900 border-l-4 border-orange-400',
    names: 'bg-purple-50 text-purple-900 border-l-4 border-purple-400',
    sent: 'bg-blue-50 text-blue-900 border-l-4 border-blue-400',
    state: 'bg-blue-50 text-blue-900 border-l-4 border-blue-400',
    debug: 'bg-gray-50 text-gray-700 border-l-4 border-gray-400',
    raw: 'bg-gray-100 text-gray-800 border-l-4 border-gray-300',
    default: 'bg-gray-50 text-gray-700 border-l-4 border-gray-200'
  };

  return (
    <div className={`min-h-screen w-full ${sectionBg} text-gray-900 dark:text-gray-100 pt-4`}>
      <div className="mx-auto w-full max-w-3xl md:max-w-4xl px-3 flex flex-col gap-10">

        {/* Header */}
        <div className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0 p-4 rounded-lg ${cardBg} shadow-lg`}>
          <div>
            <h1 className={`${heading}`}>IRC Engine (Stateless)</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">WebSocket + Parser + Event Emitter</p>
          </div>
          <div className="flex items-center gap-3">
            <Radio className={stateColors[state]} size={22} />
            <span className="text-base font-mono">{state}</span>
          </div>
        </div>

        <div className={`${divider}`}></div>

        {/* Config */}
        <div className={`rounded-lg ${cardBg} p-6 shadow`}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Servidor WebSocket</label>
              <select
                value={config.url}
                onChange={(e) => setConfig({...config, url: e.target.value})}
                className={inputClass}
                disabled={state !== 'disconnected'}>
                {wsServers.map(srv => (
                  <option key={srv.url} value={srv.url}>{srv.name} - {srv.note}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Nick</label>
                <input
                  type="text"
                  value={config.nick}
                  onChange={e => setConfig({...config, nick: e.target.value})}
                  className={inputClass}
                  disabled={state !== 'disconnected'}
                />
              </div>
              <div>
                <label className={labelClass}>Nome Real</label>
                <input
                  type="text"
                  value={config.realname}
                  onChange={e => setConfig({...config, realname: e.target.value})}
                  className={inputClass}
                  disabled={state !== 'disconnected'}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              <button onClick={handleConnect} disabled={state !== 'disconnected'} className={buttonPrimary}>
                <Power size={17} />
                Conectar
              </button>
              <button onClick={handleDisconnect} disabled={state === 'disconnected'} className={buttonDanger}>
                Desconectar
              </button>
            </div>
          </div>
        </div>

        {/* Quick Commands */}
        {state === 'connected' && (
          <div className={`${cardBg} rounded-lg p-6 border-2 border-green-500 shadow-sm`}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <h3 className="text-base font-semibold text-green-600 dark:text-green-400">🟢 Conectado - Comandos rápidos</h3>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => handleCommand('JOIN #Chat')} className={buttonSecondary}>JOIN #Chat</button>
              <button onClick={() => handleCommand('JOIN #Unreal-Support')} className={buttonSecondary}>JOIN #Unreal-Support</button>
              <button
                onClick={() => {
                  const ch = prompt('Canal:');
                  if (ch) handleCommand(`NAMES ${ch}`);
                }}
                className={`${buttonPrimary} bg-purple-600 hover:bg-purple-700`}>
                List Users
              </button>
              <button
                onClick={() => {
                  const target = prompt('Destino (canal ou nick):');
                  const msg = prompt('Mensagem:');
                  if (target && msg) {
                    clientRef.current.privmsg(target, msg);
                    addLog('message', `[${target}] <${config.nick}> ${msg}`);
                  }
                }}
                className={buttonPrimary}
              >
                Send Message
              </button>
            </div>

            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={commandInput}
                onChange={e => setCommandInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendCommand()}
                placeholder="Raw IRC command (ex: PRIVMSG #Chat :Hello!)"
                className={inputClass}
              />
              <button onClick={handleSendCommand} className={buttonPrimary}><Send size={18}/></button>
            </div>
          </div>
        )}

        <div className={`${divider}`}></div>

        {/* Console */}
        <div className={`rounded-lg ${cardBg} p-0 shadow`}>
          <h3 className={`${subheading} px-6 pt-6`}>Console IRC (últimas 50 mensagens)</h3>
          <div className="pb-6 grid gap-1">
            {logs.length === 0 && (
              <div className="text-gray-400 italic px-6 py-4">Aguardando conexão...</div>
            )}
            {logs.map((log, i) => (
              <div
                key={i}
                className={`mx-6 mt-1 rounded p-2 font-mono text-xs shadow-sm ${consoleTypes[log.type] || consoleTypes.default} flex gap-3 items-baseline`}
              >
                <span className="opacity-70 w-16 shrink-0">{log.time}</span>
                <span className="whitespace-pre-wrap">{log.data}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`${divider}`}></div>

        {/* Instruções */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-6">
          <div className="flex gap-3">
            <AlertCircle className="text-blue-400 shrink-0" size={22} />
            <div className={`${subheading} space-y-2`}>
              <p className="font-semibold text-blue-600 dark:text-blue-300">Como testar:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-200">
                <li>Servidor padrão (Ergo Testnet) já está selecionado</li>
                <li>Clique em "Conectar"</li>
                <li>Aguarde o estado mudar para "connected" (~2-3 segundos)</li>
                <li>Clique em "JOIN #test" para entrar no canal público</li>
                <li>Observe mensagens raw no console</li>
                <li>PING será respondido automaticamente (amarelo no log)</li>
              </ol>
              <p className="text-yellow-700 dark:text-yellow-300 mt-2 text-xs">
                ⚠️ Se Libera.Chat não funcionar, é porque ele não aceita WebSocket direto sem WEBIRC.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
