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
// UI DE TESTE
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

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">IRC Engine (Stateless)</h1>
            <p className="text-gray-400 mt-1">WebSocket + Parser + Event Emitter</p>
          </div>
          <div className="flex items-center gap-3">
            <Radio className={stateColors[state]} size={20} />
            <span className="text-sm font-mono">{state}</span>
          </div>
        </div>

        {/* Config */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Servidor WebSocket</label>
            <select
              value={config.url}
              onChange={(e) => setConfig({...config, url: e.target.value})}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 text-sm"
              disabled={state !== 'disconnected'}
            >
              {wsServers.map(srv => (
                <option key={srv.url} value={srv.url}>
                  {srv.name} - {srv.note}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Nick"
              value={config.nick}
              onChange={(e) => setConfig({...config, nick: e.target.value})}
              className="px-3 py-2 bg-gray-700 rounded border border-gray-600 text-sm"
              disabled={state !== 'disconnected'}
            />
            <input
              type="text"
              placeholder="Nome Real"
              value={config.realname}
              onChange={(e) => setConfig({...config, realname: e.target.value})}
              className="px-3 py-2 bg-gray-700 rounded border border-gray-600 text-sm"
              disabled={state !== 'disconnected'}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              disabled={state !== 'disconnected'}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
            >
              <Power size={16} />
              Conectar
            </button>
            <button
              onClick={handleDisconnect}
              disabled={state === 'disconnected'}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
            >
              Desconectar
            </button>
          </div>
        </div>

        {/* Quick Commands */}
        {state === 'connected' && (
          <div className="bg-gray-800 rounded-lg p-4 border-2 border-green-500">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <h3 className="text-sm font-semibold text-green-400">🟢 Conectado - Comandos Disponíveis</h3>
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              <button
                onClick={() => handleCommand('JOIN #Chat')}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
              >
                JOIN #Chat
              </button>
              <button
                onClick={() => handleCommand('JOIN #Unreal-Support')}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
              >
                JOIN #Unreal-Support
              </button>
              <button
                onClick={() => {
                  const ch = prompt('Canal:');
                  if (ch) handleCommand(`NAMES ${ch}`);
                }}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs"
              >
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
                className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs"
              >
                Send Message
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendCommand()}
                placeholder="Raw IRC command (ex: PRIVMSG #Chat :Hello!)"
                className="flex-1 px-3 py-2 bg-gray-700 rounded border border-gray-600 text-sm"
              />
              <button
                onClick={handleSendCommand}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Console */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 text-gray-400">Console (últimas 50 mensagens)</h3>
          <div className="bg-black rounded p-3 h-96 overflow-y-auto font-mono text-xs space-y-1">
            {logs.length === 0 && (
              <div className="text-gray-600 italic">Aguardando conexão...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-gray-500 shrink-0">{log.time}</span>
                <span className={
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'success' ? 'text-green-400' :
                  log.type === 'ping' ? 'text-yellow-400' :
                  log.type === 'message' ? 'text-cyan-400' :
                  log.type === 'join' ? 'text-green-300' :
                  log.type === 'part' ? 'text-orange-400' :
                  log.type === 'names' ? 'text-purple-400' :
                  log.type === 'sent' ? 'text-blue-300' :
                  log.type === 'state' ? 'text-blue-400' :
                  log.type === 'debug' ? 'text-purple-400' :
                  'text-gray-400'
                }>
                  {log.data}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Instruções */}
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="text-blue-400 shrink-0" size={20} />
            <div className="text-sm space-y-2">
              <p className="font-semibold text-blue-300">Como testar:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-300">
                <li>Servidor padrão (Ergo Testnet) já está selecionado</li>
                <li>Clique em "Conectar"</li>
                <li>Aguarde o estado mudar para "connected" (~2-3 segundos)</li>
                <li>Clique em "JOIN #test" para entrar no canal público</li>
                <li>Observe mensagens raw no console</li>
                <li>PING será respondido automaticamente (amarelo no log)</li>
              </ol>
              <p className="text-yellow-300 mt-2 text-xs">
                ⚠️ Se Libera.Chat não funcionar, é porque ele não aceita WebSocket direto sem WEBIRC.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
