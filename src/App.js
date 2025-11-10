import React, { useState, useRef, useEffect } from "react";
import "./App.css";

export default function IRCEngineDemo() {
  const [connected, setConnected] = useState(false);
  const [server, setServer] = useState("");
  const [nick, setNick] = useState("");
  const [channel, setChannel] = useState("");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState([]);
  const [currentChannel, setCurrentChannel] = useState("");
  const logEndRef = useRef(null);

  // Scroll automático
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Simulação de conexão
  const handleConnect = () => {
    if (!server || !nick) return;
    setConnected(true);
    setLogs((prev) => [...prev, { type: "system", data: `Conectado a ${server} como ${nick}` }]);
  };

  // Envio de mensagem
  const handleSend = () => {
    if (!message || !connected || !currentChannel) return;
    setLogs((prev) => [
      ...prev,
      { type: "message", channel: currentChannel, data: `<${nick}> ${message}`, time: new Date().toLocaleTimeString() },
    ]);
    setMessage("");
  };

  return (
    <div className="irc-container">
      <div className="irc-header">
        <h3>IRC Engine Demo</h3>
      </div>

      <div className="irc-body">
        {!connected ? (
          <div className="connection-form">
            <input
              type="text"
              placeholder="Servidor"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <input
              type="text"
              placeholder="Nick"
              value={nick}
              onChange={(e) => setNick(e.target.value)}
            />
            <button onClick={handleConnect}>Conectar</button>
          </div>
        ) : (
          <>
            <div className="channel-controls">
              <input
                type="text"
                placeholder="Canal"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              />
              <button
                onClick={() => {
                  if (channel) {
                    setCurrentChannel(channel);
                    setLogs((prev) => [
                      ...prev,
                      { type: "join", channel, data: `Entrou em ${channel}`, time: new Date().toLocaleTimeString() },
                    ]);
                  }
                }}
              >
                Entrar
              </button>
            </div>

            <div className="irc-panels">
              {/* Janela de Chat */}
              <div className="chat-window">
                <div className="chat-messages">
                  {logs
                    .filter((log) => log.channel === currentChannel && log.type === "message")
                    .map((log, i) => (
                      <div key={i} className="chat-line">
                        <span className="chat-time">{log.time}</span>{" "}
                        <span className="chat-text">{log.data}</span>
                      </div>
                    ))}
                  <div ref={logEndRef} />
                </div>

                <div className="chat-input">
                  <input
                    type="text"
                    placeholder="Mensagem..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  />
                  <button onClick={handleSend}>Enviar</button>
                </div>
              </div>

              {/* Janela de Console */}
              <div className="console-window">
                {logs.map((log, i) => {
                  // Ignora mensagens do canal atual
                  if (["message", "join", "part", "names"].includes(log.type) && log.channel === currentChannel)
                    return null;

                  return (
                    <div key={i} className={`console-msg console-msg-${log.type}`}>
                      <span className="console-time">{log.time}</span>{" "}
                      <span className="console-text">
                        {typeof log.data === "string" ? log.data : JSON.stringify(log.data)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
