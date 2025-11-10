import React, { useState, useRef } from "react";
import "./App.css";

// Remova lucide-react se não quiser ícones!
const Radio = ({ className = "", size = 20 }) => (
  <span
    className={`radio-icon ${className}`}
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      display: "inline-block",
      background: "linear-gradient(135deg,#8f8ce3 30%, #5c54a3 100%)",
      marginRight: 4,
    }}
  ></span>
);
const Power = ({ size = 16 }) => (
  <span style={{ fontWeight: "bold", fontSize: size, verticalAlign: "middle" }}>⏻</span>
);
const Send = ({ size = 16 }) => (
  <span style={{ fontWeight: "bold", fontSize: size, verticalAlign: "middle" }}>✉️</span>
);
const AlertCircle = ({ size = 20 }) => (
  <span style={{ fontWeight: "bold", fontSize: size, verticalAlign: "middle", color: "#4091e1" }}>🛈</span>
);

// Classes IRC (iguais ao código anterior)
class BufferManager {
  constructor() {
    this.buffer = "";
  }
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
  clear() {
    this.buffer = "";
  }
}
class IRCParser {
  static parse(line) {
    let prefix = null,
      command = null,
      params = [],
      trailing = null,
      pos = 0;
    if (line[0] === ":") {
      const spaceIdx = line.indexOf(" ");
      prefix = line.slice(1, spaceIdx);
      pos = spaceIdx + 1;
    }
    const nextSpace = line.indexOf(" ", pos);
    if (nextSpace === -1) {
      command = line.slice(pos).trim();
      return { raw: line, prefix, command, params, trailing };
    }
    command = line.slice(pos, nextSpace);
    pos = nextSpace + 1;
    const rest = line.slice(pos);
    if (rest.includes(" :")) {
      const trailingIdx = rest.indexOf(" :");
      const beforeTrailing = rest.slice(0, trailingIdx);
      trailing = rest.slice(trailingIdx + 2);
      params = beforeTrailing.split(" ").filter(Boolean);
    } else if (rest[0] === ":") {
      trailing = rest.slice(1);
    } else {
      params = rest.split(" ").filter(Boolean);
    }
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
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((cb) => cb(data));
    }
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
      const processedLines =
        lines.length > 0 ? lines : evt.data.trim() ? [evt.data.trim()] : [];
      processedLines.forEach((line) => {
        const msg = IRCParser.parse(line);
        if (msg.command === "PING") {
          this.send(`PONG ${msg.trailing || msg.params[0]}`);
          this.emit("ping", msg);
          return;
        }
        if (msg.command === "001") {
          this.connectionState = "connected";
          this.emit("state", { state: "connected" });
          this.emit("registered", msg);
          return;
        }
        if (msg.command === "PRIVMSG") {
          const target = msg.params[0];
          const sender = msg.prefix ? msg.prefix.split("!")[0] : "server";
          this.emit("message", {
            from: sender,
            to: target,
            text: msg.trailing,
            isChannel: target.startsWith("#"),
            raw: msg,
          });
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
    this.ws.addEventListener("close", (evt) => {
      this.connectionState = "disconnected";
      this.buffer.clear();
      this.emit("state", { state: "disconnected", code: evt.code });
    });
    this.ws.addEventListener("error", (err) => {
      this.emit("error", {
        type: err.type,
        timestamp: Date.now(),
        readyState: this.ws.readyState,
        url: url,
      });
    });
  }
  send(line) {
    if (this.ws && this.ws.readyState === window.WebSocket.OPEN) {
      this.ws.send(line + "\r\n");
    }
  }
  disconnect() {
    if (this.ws) this.ws.close();
  }
  join(channel) {
    this.send(`JOIN ${channel}`);
  }
  part(channel, reason = "") {
    this.send(`PART ${channel}${reason ? " :" + reason : ""}`);
  }
  privmsg(target, text) {
    this.send(`PRIVMSG ${target} :${text}`);
  }
  quit(reason = "Leaving") {
    this.send(`QUIT :${reason}`);
    setTimeout(() => this.disconnect(), 500);
  }
  names(channel) {
    this.send(`NAMES ${channel}`);
  }
}

// ===========================
// App principal
// ===========================
export default function IRCEngineDemo() {
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState("disconnected");
  const [config, setConfig] = useState({
    url: "wss://testnet.ergo.chat",
    nick: "TestBot" + Math.floor(Math.random() * 9999),
    user: "testuser",
    realname: "IRC Test Bot",
  });
  const [commandInput, setCommandInput] = useState("");
  const wsServers = [
    { name: "UnrealIRCd Demo", url: "wss://irc.unrealircd.org:443", note: "WebSocket nativo funcionando ✅" },
    { name: "Ergo Testnet", url: "wss://testnet.ergo.chat", note: "Pode estar offline" },
  ];
  const clientRef = useRef(null);

  const addLog = (type, data) => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), type, data },
    ].slice(-50));
  };
  const handleConnect = () => {
    const client = new IRCClient();
    clientRef.current = client;
    client.on("state", (data) => {
      setState(data.state);
      addLog("state", `Estado: ${data.state}`);
    });
    client.on("debug", (data) => addLog("debug", data.msg));
    client.on("registered", () => addLog("success", "Conectado! Agora você pode enviar JOIN #canal"));
    client.on("ping", () => addLog("ping", "PING recebido e respondido automaticamente"));
    client.on("message", (msg) => {
      const prefix = msg.isChannel ? `[${msg.to}]` : `[PM]`;
      addLog("message", `${prefix} <${msg.from}> ${msg.text}`);
    });
    client.on("join", (data) => addLog("join", `${data.nick} entrou em ${data.channel}`));
    client.on("part", (data) => {
      const reason = data.reason ? ` (${data.reason})` : "";
      addLog("part", `${data.nick} saiu de ${data.channel}${reason}`);
    });
    client.on("names", (data) => addLog("names", `Usuários em ${data.channel}: ${data.users.join(", ")}`));
    client.on("raw", (msg) => addLog("raw", msg.raw));
    client.on("error", (data) => addLog("error", `WebSocket Error: ${data.type} | ReadyState: ${data.readyState} | URL: ${data.url}`));
    client.connect(config.url, config.nick, config.user, config.realname);
  };
  const handleDisconnect = () => {
    if (clientRef.current) clientRef.current.disconnect();
  };
  const handleCommand = (cmd) => {
    if (!clientRef.current || state !== "connected") {
      addLog("error", "Não conectado!");
      return;
    }
    clientRef.current.send(cmd);
    addLog("sent", `→ ${cmd}`);
  };
  const handleSendCommand = () => {
    if (commandInput.trim()) {
      handleCommand(commandInput);
      setCommandInput("");
    }
  };

  const stateColors = {
    disconnected: "st-gray",
    connecting: "st-yellow",
    registering: "st-blue",
    connected: "st-green",
  };

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
            <Radio className={stateColors[state]} size={22} />
            <span className="state-label">{state}</span>
          </div>
        </div>

        <div className="divider"></div>

        {/* Config */}
        <div className="card">
          <div>
            <label className="label">Servidor WebSocket</label>
            <select
              value={config.url}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
              className="input"
              disabled={state !== "disconnected"}
            >
              {wsServers.map((srv) => (
                <option key={srv.url} value={srv.url}>
                  {srv.name} - {srv.note}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="col">
              <label className="label">Nick</label>
              <input
                type="text"
                value={config.nick}
                onChange={(e) => setConfig({ ...config, nick: e.target.value })}
                className="input"
                disabled={state !== "disconnected"}
              />
            </div>
            <div className="col">
              <label className="label">Nome Real</label>
              <input
                type="text"
                value={config.realname}
                onChange={(e) => setConfig({ ...config, realname: e.target.value })}
                className="input"
                disabled={state !== "disconnected"}
              />
            </div>
          </div>
          <div className="row gap">
            <button
              onClick={handleConnect}
              disabled={state !== "disconnected"}
              className="button connect"
            >
              <Power size={17} />
              Conectar
            </button>
            <button
              onClick={handleDisconnect}
              disabled={state === "disconnected"}
              className="button disconnect"
            >
              Desconectar
            </button>
          </div>
        </div>

        {/* Quick Commands */}
        {state === "connected" && (
          <div className="card connected">
            <div className="row connected-status">
              <div className="dot"></div>
              <h3 className="connected-label">🟢 Conectado - Comandos rápidos</h3>
            </div>
            <div className="row gap">
              <button onClick={() => handleCommand("JOIN #Chat")} className="button alt">
                JOIN #Chat
              </button>
              <button onClick={() => handleCommand("JOIN #Unreal-Support")} className="button alt">
                JOIN #Unreal-Support
              </button>
              <button
                onClick={() => {
                  const ch = prompt("Canal:");
                  if (ch) handleCommand(`NAMES ${ch}`);
                }}
                className="button purple"
              >
                List Users
              </button>
              <button
                onClick={() => {
                  const target = prompt("Destino (canal ou nick):");
                  const msg = prompt("Mensagem:");
                  if (target && msg) {
                    clientRef.current.privmsg(target, msg);
                    addLog("message", `[${target}] <${config.nick}> ${msg}`);
                  }
                }}
                className="button connect"
              >
                Send Message
              </button>
            </div>
            <div className="row">
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendCommand()}
                placeholder="Raw IRC command (ex: PRIVMSG #Chat :Hello!)"
                className="input"
              />
              <button onClick={handleSendCommand} className="button connect">
                <Send size={18} />
              </button>
            </div>
          </div>
        )}

        <div className="divider"></div>

        {/* Console */}
        <div className="card console-card">
          <h3 className="console-heading">Console IRC (últimas 50 mensagens)</h3>
          <div className="console-list">
            {logs.length === 0 && (
              <div className="console-msg console-msg-default italic">
                Aguardando conexão...
              </div>
            )}
            {logs.map((log, i) => (
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

        <div className="divider"></div>

        {/* Instruções */}
        <div className="card info-card">
          <div className="row">
            <AlertCircle size={22} />
            <div>
              <p className="info-title">Como testar:</p>
              <ol className="info-list">
                <li>Servidor padrão (Ergo Testnet) já está selecionado</li>
                <li>Clique em "Conectar"</li>
                <li>Aguarde o estado mudar para "connected" (~2-3 segundos)</li>
                <li>Clique em "JOIN #test" para entrar no canal público</li>
                <li>Observe mensagens raw no console</li>
                <li>PING será respondido automaticamente (amarelo no log)</li>
              </ol>
              <p className="warn">
                ⚠️ Se Libera.Chat não funcionar, é porque ele não aceita WebSocket direto sem WEBIRC.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
