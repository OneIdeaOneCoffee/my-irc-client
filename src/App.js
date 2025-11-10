import React, { useState, useRef } from "react";
import "./App.css";

// Ícones simplificados (podem trocar depois)
const Radio = ({ className = "", size = 20 }) => <span className={`radio-icon ${className}`} style={{ width: size, height: size }} />;
const Power = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>⏻</span>;
const Send = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>✉️</span>;
const User = ({ size = 16 }) => <span style={{fontWeight:"bold",fontSize:size}}>👤</span>;

class BufferManager {/* ... igual como antes ... */}
class IRCParser {/* ... igual como antes ... */}
class IRCClient {/* ... igual como antes ... */}

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
  { cmd: "PRIVMSG Nick Olá!", label: "Mensagem privada" },
];

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
  const [channelUsers, setChannelUsers] = useState([]);
  const [currentChannel, setCurrentChannel] = useState("#Chat");
  const wsServers = [
    { name: "UnrealIRCd Demo", url: "wss://irc.unrealircd.org:443", note: "WebSocket nativo funcionando ✅" },
    { name: "Ergo Testnet", url: "wss://testnet.ergo.chat", note: "Pode estar offline" },
  ];
  const clientRef = useRef(null);

  const addLog = (type, data, channel = currentChannel) => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), type, data, channel },
    ].slice(-200));
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
    // Detecta comandos de canal para ajustar área:
    if (/^JOIN\s+[#\w]+/i.test(cmd)) {
      const ch = cmd.split(" ")[1];
      setCurrentChannel(ch);
      setChannelUsers([]);
    }
    if (/^PART\s+[#\w]+/i.test(cmd)) {
      setChannelUsers([]);
    }
  };
  const handleSendCommand = () => {
    if (commandInput.trim()) {
      handleCommand(commandInput);
      setCommandInput("");
    }
  };

  // Logs só do canal atual:
  const filteredLogs = logs.filter(l => l.channel === currentChannel || l.type === "state" || l.type === "success" || l.type === "error");

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

        {/* Após entrar no chat */}
        {state === "connected" && (
          <div className="row card chat-area">
            {/* Users list */}
            <div className="users-list">
              <h4 className="userlist-title"><User /> Usuários ({channelUsers.length}):</h4>
              <div className="userlist-list">
                {channelUsers.length === 0 && <div className="userlist-empty">Nenhum usuário listado.</div>}
                {channelUsers.map((u, i) => (<div key={i} className="userlist-item">{u}</div>))}
              </div>
            </div>
            {/* Chat/messages area */}
            <div className="chat-messages">
              <h4 className="chat-title">Chat: <span style={{color:"#54a0ff"}}>{currentChannel}</span></h4>
              <div className="console-list chat-console">
                {filteredLogs.length === 0 && <div className="console-msg console-msg-default">Sem mensagens ainda.</div>}
                {filteredLogs.map((log, i) => (
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
        )}

        {/* Botões comandos IRC */}
        {state === "connected" && (
          <div className="card cmd-btns-area">
            <div className="cmd-btns-row">
              {DEFAULT_COMMANDS.map(({ cmd, label }, i) => (
                <button key={i} className={`button alt`} onClick={() => handleCommand(cmd)} title={cmd}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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
