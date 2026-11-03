import {
  ENABLED_MATCH_FORMATS,
  ROOM_CODE_LENGTH,
  playerNameSchema,
  roomCodeSchema,
  type MatchFormat,
} from '@zhb/shared';
import { useState } from 'react';
import { useNetwork } from '../hooks/useNetwork.ts';
import { network } from '../services/network.ts';
import { loadPlayerName, savePlayerName } from '../services/playerName.ts';

/** `#/play/ABC234` (an invite link) prefills the room code. */
function codeFromHash(): string {
  const part = window.location.hash.split('/')[2] ?? '';
  const parsed = roomCodeSchema.safeParse(part);
  return parsed.success ? parsed.data : '';
}

export function PlayPage() {
  const net = useNetwork();
  const [name, setName] = useState(loadPlayerName);
  const [format, setFormat] = useState<MatchFormat>('1v1');
  const [code, setCode] = useState(codeFromHash);

  const nameCheck = playerNameSchema.safeParse(name);
  const codeCheck = roomCodeSchema.safeParse(code);
  const busy = net.status === 'connecting' || net.status === 'reconnecting';
  const validName = nameCheck.success ? nameCheck.data : null;
  const nameError = nameCheck.success ? null : 'Use 2-24 letters, numbers, spaces, _ . -';

  const run = (action: (validName: string) => Promise<boolean>) => {
    if (!validName || busy) return;
    savePlayerName(validName);
    void action(validName);
  };

  return (
    <main className="panel panel-wide">
      <p className="eyebrow">PLAY · COMPETITIVE</p>
      <h2>Find a match</h2>

      <div className="field">
        <label htmlFor="player-name">Callsign</label>
        <input
          id="player-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={nameError !== null}
          autoComplete="off"
        />
        {nameError && <span className="field-error">{nameError}</span>}
      </div>

      <div className="field">
        <span className="field-label" id="format-label">
          Format
        </span>
        <div role="radiogroup" aria-labelledby="format-label" className="segmented">
          {ENABLED_MATCH_FORMATS.map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={format === f}
              className="segment"
              onClick={() => setFormat(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="play-actions">
        <button
          className="action action-live"
          disabled={!nameCheck.success || busy}
          onClick={() => run((n) => network.quickPlay(n, format))}
        >
          <span className="action-label">Play Online</span>
          <span className="action-hint">Join an open {format} lobby or open a new one</span>
        </button>
        <button
          className="action action-live"
          disabled={!nameCheck.success || busy}
          onClick={() => run((n) => network.createRoom(n, format, 'private'))}
        >
          <span className="action-label">Create Private Room</span>
          <span className="action-hint">Get a code to share with friends</span>
        </button>
        <div className="action join-box">
          <span className="action-label">Join With Room Code</span>
          <div className="join-row">
            <input
              aria-label="Room code"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="ABC234"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="code-input"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="btn"
              disabled={!nameCheck.success || !codeCheck.success || busy}
              onClick={() => codeCheck.success && run((n) => network.joinRoom(n, codeCheck.data))}
            >
              Join
            </button>
          </div>
        </div>
      </div>

      {busy && (
        <p className="note" role="status">
          {net.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        </p>
      )}
      {net.error && (
        <p className="field-error" role="alert">
          {net.error}
        </p>
      )}
    </main>
  );
}
