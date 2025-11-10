import React, { useState, useRef } from "react";
import "./App.css";

// Ícones simplificados
const Radio = ({ className = "", size = 20 }) => <span className={`radio-icon ${className}`} style={{ width: size, height: size }} />;
const Power = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>⏻</span>;
const Send = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>✉️</span>;
const User = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>👤</span>;

class BufferManager {
  constructor() { this.buffer = ""; }
  push(chunk) {
    this.buffer += chunk;
    const lines = [];
    while (this.buffer.includes("\r\n")) {
      const idx = this.buffer.indexOf("\r\n");
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 2);
    }
    return lines;
  }
  clear() { this.buffer = ""; }
}
class IRCParser {
  static parse(line) {
    let prefix = null, command = null, params = [], trailing = null, pos = 0;
    if (line[0] === ":") { const spaceIdx = line.indexOf(" "); prefix = line.slice(1, spaceIdx); pos = spaceIdx + 1; }
    const nextSpace = line.indexOf(" ", pos);
    if (nextSpace === -1) { command = line.slice(pos).trim(); return { raw: line, prefix, command, params, trailing }; }
    command = line.slice(pos, nextSpace); pos = nextSpace + 1;
    const rest = line.slice(pos);
    if (rest.includes(" :")) { const trailingIdx = rest.indexOf(" :"); const beforeTrailing = rest.slice(0, trailingIdx); trailing = rest.slice(trailingIdx + 2); params = beforeTrailing.split(" ").filter(Boolean); }
    else if (rest[0] === ":") { trailing = rest.slice(1); } else { params = rest.split(" ").filter(Boolean); }
    return { raw: line, prefix, command, params, trailing };
  }
}
class IRCClient {
  constructor() {
    this.ws = null;
    this.buffer = new BufferManager();
    this.listeners = new Map();
    this.connectionState = "disconnected";
  }
  on(event, callback) {
    if (!this.listeners.has(event)) { this.listeners.set(event, []); }
    this.listeners.get(event).push(callback);
  }
  emit(event, data) {
    if (this.listeners.has(event)) { this.listeners.get(event).forEach((cb) => cb(data)); }
  }
  connect(url, nick, user, realname, password = null) {
    this.connectionState = "connecting";
    this.emit("state", { state: "connecting" });
    this.ws = new window.WebSocket(url);
    this.ws.addEventListener("open", () => {
      this.connectionState = "registering";
      this.emit("state", { state: "registering" });
      this.emit("debug", { msg: "WebSocket aberto, iniciando handshake IRC" });
      if (password) this.send(`PASS ${password}`);
      this.send(`NICK ${nick}`);
      this.send(`USER ${user} 0 * :${realname}`);
    });
    this.ws.addEventListener("message", (evt) => {
      const lines = this.buffer.push(evt.data);
      const processedLines = lines.length > 0 ? lines : evt.data.trim() ? [evt.data.trim()] : [];
      processedLines.forEach((line) => {
        const msg = IRCParser.parse(line);
        if (msg.command === "PING") { this.send(`PONG ${msg.trailing || msg.params[0]}`); this.emit("ping", msg); return; }
        if (msg.command === "001") { this.connectionState = "connected"; this.emit("state", { state: "connected" }); this.emit("registered", msg); return; }
        if (msg.command === "PRIVMSG") {
          const target = msg.params[0];
          const sender = msg.prefix ? msg.prefix.split("!")[0] : "server";
          this.emit("message", { from: sender, to: target, text: msg.trailing, isChannel: target.startsWith("#"), raw: msg });
        } else if (msg.command === "JOIN") {
          const nick = msg.prefix ? msg.prefix.split("!")[0] : "";
          const channel = msg.trailing || msg.params[0];
          this.emit("join", { nick, channel, raw: msg });
        } else if (msg.command === "PART") {
          const nick = msg.prefix ? msg.prefix.split("!")[0] : "";
          const channel = msg.params[0];
          this.emit("part", { nick, channel, reason: msg.trailing, raw: msg });
        } else if (msg.command === "353") {
          const channel = msg.params[2];
          const users = msg.trailing ? msg.trailing.split(" ") : [];
          this.emit("names", { channel, users, raw: msg });
        }
        this.emit("raw", msg);
      });
    });
    this.ws.addEventListener("close", (evt) => { this.connectionState = "disconnected"; this.buffer.clear(); this.emit("state", { state: "disconnected", code: evt.code }); });
    this.ws.addEventListener("error", (err) => {
      this.emit("error", { type: err.type, timestamp: Date.now(), readyState: this.ws.readyState, url: url });
    });
  }
  send(line) { if (this.ws && this.ws.readyState === window.WebSocket.OPEN) { this.ws.send(line + "\r\n"); } }
  disconnect() { if (this.ws) this.ws.close(); }
  join(channel) { this.send(`JOIN ${channel}`); }
  part(channel, reason = "") { this.send(`PART ${channel}${reason ? " :" + reason : ""}`); }
  privmsg(target, text) { this.send(`PRIVMSG ${target} :${text}`); }
  quit(reason = "Leaving") { this.send(`QUIT :${reason}`); setTimeout(() => this.disconnect(), 500); }
  names(channel) { this.send(`NAMES ${channel}`); }
}

const DEFAULT_COMMANDS = [
  { cmd: "JOIN #Chat", label: "Entrar canal" },
  { cmd: "PART #Chat", label: "Sair canal" },
  { cmd: "LEAVE", label: "Desconectar" },
  { cmd: "NICK NovoNick", label: "Trocar nick" },
  { cmd: "WHO #Chat", label: "Quem está online" },
  { cmd: "TOPIC #Chat Novo tópico", label: "Alterar tópico" },
  { cmd: "AWAY Estou ausente", label: "Ausente" },
  { cmd: "INVITE Nick #Chat", label: "Convidar" },
  { cmd: "NOTICE Nick Olá!", label: "Aviso privado" },
  { cmd: "PRIVMSG Nick Olá!", label: "Mensagem privada" }
];

export default function IRCEngineDemo() {
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState("disconnected");
  const [config, setConfig] = useState({
    url: "wss://testnet.ergo.chat",
    nick: "TestBot" + Math.floor(Math.random() * 9999),
    user: "testuser",
    realname: "IRC Test Bot"
  });
  const [commandInput, setCommandInput] = useState("");
  const [channelUsers, setChannelUsers] = useState([]);
  const [currentChannel, setCurrentChannel] = useState("#Chat");
  const wsServers = [
    { name: "UnrealIRCd Demo", url: "wss://irc.unrealircd.org:443", note: "WebSocket nativo funcionando ✅" },
    { name: "Ergo Testnet", url: "wss://testnet.ergo.chat", note: "Pode estar offline" }
  ];
  const clientRef = useRef(null);

  const addLog = (type, data, channel = currentChannel) => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), type, data, channel }
    ].slice(-300));
  };

  const handleConnect = () => {
    const client = new IRCClient();
    clientRef.current = client;
    client.on("state", (data) => { setState(data.state); addLog("state", `Estado: ${data.state}`); });
    client.on("debug", (data) => addLog("debug", data.msg));
    client.on("registered", () => addLog("success", "Conectado! Agora você pode enviar JOIN #canal"));
    client.on("ping", () => addLog("ping", "PING recebido e respondido automaticamente"));
    client.on("message", (msg) => {
      const prefix = msg.isChannel ? `[${msg.to}]` : `[PM]`;
      addLog("message", `${prefix} <${msg.from}> ${msg.text}`, msg.to);
    });
    client.on("join", (data) => {
      addLog("join", `${data.nick} entrou em ${data.channel}`, data.channel);
      if (data.channel === currentChannel && !channelUsers.includes(data.nick)) {
        setChannelUsers((users) => Array.from(new Set([...users, data.nick])));
      }
    });
    client.on("part", (data) => {
      addLog("part", `${data.nick} saiu de ${data.channel}`, data.channel);
      if (data.channel === currentChannel) {
        setChannelUsers((users) => users.filter(nick => nick !== data.nick));
      }
    });
    client.on("names", (data) => {
      addLog("names", `Usuários em ${data.channel}: ${data.users.join(", ")}`, data.channel);
      if (data.channel === currentChannel) setChannelUsers(data.users);
    });
    client.on("raw", (msg) => addLog("raw", msg.raw));
    client.on("error", (data) => addLog("error", `WebSocket Error: ${data.type} | ReadyState: ${data.readyState} | URL: ${data.url}`));
    client.connect(config.url, config.nick, config.user, config.realname);
  };

  const handleDisconnect = () => { if (clientRef.current) clientRef.current.disconnect(); };
  const handleCommand = (cmd) => {
    if (!clientRef.current || state !== "connected") {
      addLog("error", "Não conectado!");
      return;
    }
    clientRef.current.send(cmd);
    addLog("sent", `→ ${cmd}`);
    if (/^JOIN\s+[#\w]+/i.test(cmd)) {
      const ch = cmd.split(" ")[1];
      setCurrentChannel(ch);
      setChannelUsers([]);
    }
    if (/^PART\s+[#\w]+/i.test(cmd)) {
      setChannelUsers([]);
    }
  };
  const handleSendCommand = () => { if (commandInput.trim()) { handleCommand(commandInput); setCommandInput(""); } };

  // Só chat do canal
  const chatLogs = logs.filter(l => l.channel === currentChannel && (l.type === "message" || l.type === "join" || l.type === "part" || l.type === "names"));
  // Console: mostra tudo
  const consoleLogs = logs;

  return (
    <div className="app-root">
      <div className="container">
        {/* Header */}
        <div className="card header-card">
          <div>
            <h1 className="heading">IRC Engine (Stateless)</h1>
            <p className="subtitle">WebSocket + Parser + Event Emitter</p>
          </div>
          <div className="header-state">
            <Radio className={state === "connected" ? "st-green" : state === "connecting" ? "st-yellow" : state === "registering" ? "st-blue" : "st-gray"} size={22} />
            <span className="state-label">{state}</span>
          </div>
        </div>
        <div className="divider"></div>

        {/* Conexão */}
        <div className="card">
          <label className="label">Servidor WebSocket</label>
          <select value={config.url} onChange={e => setConfig({ ...config, url: e.target.value })} className="input"
            disabled={state !== "disconnected"}>
            {wsServers.map(srv => <option key={srv.url} value={srv.url}>{srv.name} - {srv.note}</option>)}
          </select>
          <div className="row">
            <div className="col">
              <label className="label">Nick</label>
              <input type="text" value={config.nick} onChange={e => setConfig({ ...config, nick: e.target.value })} className="input"
                disabled={state !== "disconnected"} />
            </div>
            <div className="col">
              <label className="label">Nome Real</label>
              <input type="text" value={config.realname} onChange={e => setConfig({ ...config, realname: e.target.value })} className="input"
                disabled={state !== "disconnected"} />
            </div>
          </div>
          <div className="row gap">
            <button onClick={handleConnect} disabled={state !== "disconnected"} className="button connect"><Power />Conectar</button>
            <button onClick={handleDisconnect} disabled={state === "disconnected"} className="button disconnect">Desconectar</button>
          </div>
        </div>

        {/* Main: Chat + Usuários + Comandos */}
        {state === "connected" && (
          <>
            <div className="chat-users-block">
              <div className="row chat-area">
                {/* Usuários */}
                <div className="users-list">
                  <h4 className="userlist-title"><User /> Usuários ({channelUsers.length}):</h4>
                  <div className="userlist-list">
                    {channelUsers.length === 0 && <div className="userlist-empty">Nenhum usuário listado.</div>}
                    {channelUsers.map((u, i) => (<div key={i} className="userlist-item">{u}</div>))}
                  </div>
                </div>
                {/* Chat */}
                <div className="chat-messages">
                  <h4 className="chat-title">Chat: <span style={{color:"#54a0ff"}}>{currentChannel}</span></h4>
                  <div className="console-list chat-console">
                    {chatLogs.length === 0 && <div className="console-msg console-msg-default">Sem mensagens ainda.</div>}
                    {chatLogs.map((log, i) => (
                      <div key={i} className={`console-msg console-msg-${log.type}`}>
                        <span className="console-time">{log.time}</span>
                        <span className="console-text">{log.data}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row">
                    <input type="text" value={commandInput} onChange={e => setCommandInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendCommand()}
                      className="input" placeholder={`Digite para enviar ao canal (${currentChannel})`} />
                    <button className="button connect" onClick={handleSendCommand}><Send /></button>
                  </div>
                </div>
              </div>
              {/* Botões comandos IRC */}
              <div className="card cmd-btns-area">
                <div className="cmd-btns-row">
                  {DEFAULT_COMMANDS.map(({ cmd, label }, i) => (
                    <button key={i} className={`button alt`} onClick={() => handleCommand(cmd)} title={cmd}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Console IRC SEPARADO ABAIXO */}
            <div className="irc-console-block">
              <div className="card console-card">
                <h3 className="console-heading">Console IRC (todos eventos)</h3>
                <div className="console-list irc-console-list">
                  {consoleLogs.length === 0 && (
                    <div className="console-msg console-msg-default italic">
                      Aguardando conexão...
                    </div>
                  )}
                  {consoleLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`console-msg console-msg-${log.type}`}
                    >
                      <span className="console-time">{log.time}</span>
                      <span className="console-text">{log.data}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="divider"></div>
        {/* Instruções */}
        <div className="card info-card">
          <div className="row">
            <span style={{fontWeight:"bold",fontSize:"1.4em",color:"#4091e1"}}>🛈</span>
            <div>
              <p className="info-title">Como testar:</p>
              <ol className="info-list">
                <li>Servidor padrão (Ergo Testnet) já está selecionado</li>
                <li>Clique em "Conectar"</li>
                <li>Aguarde o estado mudar para "connected" (~2-3 segundos)</li>
                <li>Clique em "JOIN #test" para entrar no canal público</li>
                <li>Observe mensagens raw no chat</li>
                <li>PING será respondido automaticamente (amarelo no log)</li>
              </ol>
              <p className="warn">⚠️ Se Libera.Chat não funcionar, é porque ele não aceita WebSocket direto sem WEBIRC.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
