"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stage = "lobby" | "matching" | "battle" | "results" | "leaderboard";

type Prompt = {
  title: string;
  cue: string;
  emoji: string;
  judge: string;
  color: string;
  weights: [number, number, number];
};

type Score = {
  total: number;
  power: number;
  control: number;
  character: number;
};

const prompts: Prompt[] = [
  {
    title: "The Joy Bark",
    cue: "Your human just came home after 100 years.",
    emoji: "🥹",
    judge: "Bright tone · rising energy · pure joy",
    color: "#ffcc4d",
    weights: [0.35, 0.2, 0.45],
  },
  {
    title: "Tiny But Terrifying",
    cue: "You weigh six pounds. Act like you own the block.",
    emoji: "😤",
    judge: "Big power · sharp attacks · no hesitation",
    color: "#ff735c",
    weights: [0.55, 0.25, 0.2],
  },
  {
    title: "The Dramatic Whimper",
    cue: "Dinner is seventeen seconds late. Devastating.",
    emoji: "🥺",
    judge: "Dynamic range · restraint · emotional damage",
    color: "#b69cff",
    weights: [0.15, 0.4, 0.45],
  },
  {
    title: "Moonlight Howl",
    cue: "Call the whole pack. Make it cinematic.",
    emoji: "🌕",
    judge: "Sustain · smooth tone · legendary finish",
    color: "#79d8ff",
    weights: [0.4, 0.4, 0.2],
  },
  {
    title: "Rapid-Fire Yaps",
    cue: "The mail carrier has entered your jurisdiction.",
    emoji: "📦",
    judge: "Fast attacks · rhythm · maximum urgency",
    color: "#b8ec57",
    weights: [0.3, 0.25, 0.45],
  },
  {
    title: "The Sneaky Boof",
    cue: "You heard something downstairs. Probably a sock.",
    emoji: "🕵️",
    judge: "Quiet control · suspense · one perfect boof",
    color: "#f4a4e3",
    weights: [0.15, 0.55, 0.3],
  },
];

const rivals = [
  { name: "Waffles", place: "Austin, USA", breed: "GOLDEN MENACE", face: "🐕", rating: 1412 },
  { name: "Mochi", place: "Tokyo, Japan", breed: "TINY TYRANT", face: "🐶", rating: 1388 },
  { name: "Beans", place: "Dublin, Ireland", breed: "BARK SPECIALIST", face: "🐕‍🦺", rating: 1451 },
  { name: "Pickles", place: "Toronto, Canada", breed: "HOWL PRODIGY", face: "🦮", rating: 1364 },
];

const leaderboard = [
  { rank: 1, name: "Sir Barksalot", tag: "HOWL ROYALTY", elo: 1842, face: "🐕‍🦺", delta: "+31" },
  { rank: 2, name: "Luna", tag: "MOON CALLER", elo: 1796, face: "🐺", delta: "+18" },
  { rank: 3, name: "Cheddar", tag: "LOUD & PROUD", elo: 1731, face: "🦮", delta: "+44" },
  { rank: 4, name: "Tofu", tag: "WHIMPER WIZARD", elo: 1689, face: "🐶", delta: "+9" },
  { rank: 5, name: "Biggie Paws", tag: "BASS DIVISION", elo: 1654, face: "🐕", delta: "+22" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function Waveform({ values, active, color }: { values: number[]; active: boolean; color: string }) {
  const bars = values.length ? values.slice(-36) : Array.from({ length: 36 }, (_, i) => 10 + ((i * 13) % 26));
  return (
    <div className={`waveform ${active ? "waveform--active" : ""}`} aria-hidden="true">
      {bars.map((value, index) => (
        <span
          key={index}
          style={{
            height: `${clamp(value, 8, 96)}%`,
            backgroundColor: active ? color : "rgba(255,255,255,.24)",
          }}
        />
      ))}
    </div>
  );
}

function PawMark() {
  return (
    <span className="paw-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("lobby");
  const [promptIndex, setPromptIndex] = useState(0);
  const [rivalIndex, setRivalIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(10);
  const [isRecording, setIsRecording] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [mediaNote, setMediaNote] = useState("Camera + mic check happens when you enter.");
  const [wave, setWave] = useState<number[]>([]);
  const [opponentWave, setOpponentWave] = useState<number[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [rivalScore, setRivalScore] = useState<Score | null>(null);
  const [rating, setRating] = useState(1337);
  const [record, setRecord] = useState({ wins: 12, losses: 4 });
  const [round, setRound] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const samplesRef = useRef<number[]>([]);
  const crossingsRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const prompt = prompts[promptIndex];
  const rival = rivals[rivalIndex];
  const totalMatches = record.wins + record.losses;
  const winRate = totalMatches ? Math.round((record.wins / totalMatches) * 100) : 0;

  useEffect(() => {
    const profileTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("barkoff-profile");
        if (!saved) return;
        const profile = JSON.parse(saved) as { rating?: number; wins?: number; losses?: number };
        setRating(profile.rating ?? 1337);
        setRecord({ wins: profile.wins ?? 12, losses: profile.losses ?? 4 });
      } catch {
        // Start with the demo profile if local data is malformed.
      }
    }, 0);
    return () => {
      window.clearTimeout(profileTimer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      void contextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [stage, micReady]);

  const selectRound = useCallback(() => {
    setPromptIndex((Math.floor(Math.random() * prompts.length) + round) % prompts.length);
    setRivalIndex((Math.floor(Math.random() * rivals.length) + round) % rivals.length);
    setTimeLeft(10);
    setWave([]);
    setOpponentWave([]);
    setScore(null);
    setRivalScore(null);
  }, [round]);

  const requestMedia = useCallback(async () => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaNote("Your browser has no media input. Demo scoring is still available.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setMicReady(true);
      setHasVideo(stream.getVideoTracks().length > 0);
      setMediaNote("Camera + mic ready. Nothing is uploaded.");
      if (videoRef.current) videoRef.current.srcObject = stream;
      return true;
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = audioOnly;
        setMicReady(true);
        setHasVideo(false);
        setMediaNote("Mic ready. Camera is off.");
        return true;
      } catch {
        setMediaNote("Media access was skipped. We’ll run the round in demo mode.");
        return false;
      }
    }
  }, []);

  const enterArena = async () => {
    selectRound();
    setStage("matching");
    void requestMedia();
    window.setTimeout(() => setStage("battle"), 1700);
  };

  const calculateScore = useCallback(() => {
    const samples = samplesRef.current;
    const crossings = crossingsRef.current;
    const fallback = samples.length < 8;
    const average = fallback
      ? 0.48 + Math.random() * 0.18
      : samples.reduce((sum, item) => sum + item, 0) / samples.length;
    const variance = fallback
      ? 0.08
      : samples.reduce((sum, item) => sum + Math.pow(item - average, 2), 0) / samples.length;
    const max = fallback ? 0.82 : Math.max(...samples);
    const crossingAverage = crossings.length
      ? crossings.reduce((sum, item) => sum + item, 0) / crossings.length
      : 0.12;

    const power = clamp(Math.round(48 + average * 58 + max * 18), 42, 99);
    const control = clamp(Math.round(96 - Math.sqrt(variance) * 72 + (samples.length > 100 ? 4 : 0)), 44, 99);
    const character = clamp(Math.round(56 + Math.sqrt(variance) * 118 + crossingAverage * 80), 46, 99);
    const [powerWeight, controlWeight, characterWeight] = prompt.weights;
    const total = clamp(
      Math.round(power * powerWeight + control * controlWeight + character * characterWeight),
      48,
      99,
    );

    const rivalPower = 68 + Math.floor(Math.random() * 25);
    const rivalControl = 70 + Math.floor(Math.random() * 23);
    const rivalCharacter = 67 + Math.floor(Math.random() * 27);
    const calculatedRival = clamp(
      Math.round(
        rivalPower * powerWeight +
          rivalControl * controlWeight +
          rivalCharacter * characterWeight,
      ),
      55,
      96,
    );

    const yourScore = { total, power, control, character };
    const theirScore = {
      total: calculatedRival,
      power: rivalPower,
      control: rivalControl,
      character: rivalCharacter,
    };
    setScore(yourScore);
    setRivalScore(theirScore);

    const won = total >= calculatedRival;
    const eloChange = won ? 14 : -9;
    const nextRating = Math.max(800, rating + eloChange);
    const nextRecord = won
      ? { ...record, wins: record.wins + 1 }
      : { ...record, losses: record.losses + 1 };
    setRating(nextRating);
    setRecord(nextRecord);
    window.localStorage.setItem(
      "barkoff-profile",
      JSON.stringify({ rating: nextRating, ...nextRecord }),
    );
    window.setTimeout(() => setStage("results"), 750);
  }, [prompt.weights, rating, record]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setIsRecording(false);
    calculateScore();
  }, [calculateScore]);

  const startRecording = async () => {
    const hasMedia = await requestMedia();
    setIsRecording(true);
    setTimeLeft(10);
    samplesRef.current = [];
    crossingsRef.current = [];
    setWave([]);
    setOpponentWave([]);

    if (hasMedia && streamRef.current) {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass();
      contextRef.current = context;
      const source = context.createMediaStreamSource(streamRef.current);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.45;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const sampleAudio = () => {
        analyser.getByteTimeDomainData(data);
        let energy = 0;
        let crossings = 0;
        for (let index = 0; index < data.length; index += 1) {
          const normalized = (data[index] - 128) / 128;
          energy += normalized * normalized;
          if (index > 0 && (data[index - 1] - 128) * (data[index] - 128) < 0) crossings += 1;
        }
        const rms = Math.sqrt(energy / data.length);
        const boosted = clamp(rms * 5.4, 0.02, 1);
        samplesRef.current.push(boosted);
        crossingsRef.current.push(crossings / data.length);
        setWave((current) => [...current.slice(-35), 10 + boosted * 86]);
        setOpponentWave((current) => [
          ...current.slice(-35),
          18 + Math.random() * 58 + Math.sin(Date.now() / 170) * 14,
        ]);
        animationRef.current = requestAnimationFrame(sampleAudio);
      };
      sampleAudio();
    } else {
      const demoAudio = () => {
        const value = 0.34 + Math.random() * 0.43 + Math.sin(Date.now() / 130) * 0.12;
        samplesRef.current.push(clamp(value, 0.05, 0.95));
        crossingsRef.current.push(0.08 + Math.random() * 0.12);
        setWave((current) => [...current.slice(-35), 12 + value * 78]);
        setOpponentWave((current) => [...current.slice(-35), 16 + Math.random() * 72]);
        animationRef.current = requestAnimationFrame(demoAudio);
      };
      demoAudio();
    }

    let remaining = 10;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) stopRecording();
    }, 1000);
  };

  const newRound = () => {
    setRound((current) => current + 1);
    selectRound();
    setStage("matching");
    window.setTimeout(() => setStage("battle"), 1500);
  };

  const winner = score && rivalScore ? score.total >= rivalScore.total : false;
  const userRank = useMemo(() => Math.max(6, 240 - Math.floor((rating - 1200) / 3)), [rating]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setStage("lobby")} aria-label="Barkoff home">
          <PawMark />
          <span>BARK<span className="brand-slant">OFF</span></span>
        </button>
        <nav aria-label="Main navigation">
          <button className={stage !== "leaderboard" ? "nav-active" : ""} onClick={() => setStage("lobby")}>
            Arena
          </button>
          <button className={stage === "leaderboard" ? "nav-active" : ""} onClick={() => setStage("leaderboard")}>
            Leaderboard
          </button>
        </nav>
        <div className="profile-pill">
          <span className="status-dot" />
          <span className="profile-copy"><small>YOUR ELO</small><strong>{rating}</strong></span>
          <span className="profile-dog">🐶</span>
        </div>
      </header>

      {stage === "lobby" && (
        <section className="lobby">
          <div className="eyebrow"><span>LIVE</span> 2,418 pups barking now</div>
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="kicker">THE INTERNET&apos;S #1 COMPETITIVE BARKING ARENA</p>
              <h1>PROVE YOU&apos;RE<br /><em>TOP DOG.</em></h1>
              <p className="hero-sub">
                Get a random bark prompt. Face a mystery rival. You have ten seconds to make the pack proud.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={enterArena}>
                  <span>ENTER THE BARKENA</span><b>→</b>
                </button>
                <span className="privacy-note"><span>●</span> Media stays on your device</span>
              </div>
            </div>
            <div className="arena-preview" aria-label="Barkoff match preview">
              <div className="preview-sticker">HEAD-TO-HEAD</div>
              <div className="preview-player preview-player--one">
                <div className="dog-portrait dog-portrait--cream">🐶</div>
                <span>YOU</span>
              </div>
              <div className="versus-badge">VS</div>
              <div className="preview-player preview-player--two">
                <div className="dog-portrait dog-portrait--dark">🐕‍🦺</div>
                <span>???</span>
              </div>
              <div className="prompt-ticket">
                <small>TODAY&apos;S WILD CARD</small>
                <strong>“THE DRAMATIC<br />WHIMPER”</strong>
                <span>🥺</span>
              </div>
              <div className="sound-lines sound-lines--left"><i /><i /><i /></div>
              <div className="sound-lines sound-lines--right"><i /><i /><i /></div>
            </div>
          </div>
          <div className="stats-strip">
            <div><strong>10</strong><span>SECONDS<br />TO BARK</span></div>
            <div><strong>24K</strong><span>BARKS<br />JUDGED TODAY</span></div>
            <div><strong>AI</strong><span>POWERED<br />BARK ANALYSIS</span></div>
            <div><strong>{winRate}%</strong><span>YOUR<br />WIN RATE</span></div>
          </div>
          <div className="how-it-works">
            <span className="section-label">HOW IT WORKS</span>
            <div><b>01</b><strong>GET MATCHED</strong><p>Meet a worthy rival from anywhere in the world.</p></div>
            <div><b>02</b><strong>SEE THE PROMPT</strong><p>Joy bark? Tiny yap? Cinematic howl? No prep.</p></div>
            <div><b>03</b><strong>BARK FOR GLORY</strong><p>Audio features score power, control, and character.</p></div>
          </div>
          <div className="hackathon-ribbon">BUILT FOR CORGI HACKS <span>✦</span> MAY THE BEST BARK WIN</div>
        </section>
      )}

      {stage === "matching" && (
        <section className="matching-screen">
          <div className="radar">
            <span className="radar-ring radar-ring--one" />
            <span className="radar-ring radar-ring--two" />
            <span className="radar-ring radar-ring--three" />
            <span className="radar-dog">🐶</span>
          </div>
          <p className="kicker">SNIFFING AROUND THE GLOBE...</p>
          <h2>FINDING YOUR<br /><em>WORTHY RIVAL</em></h2>
          <div className="match-progress"><span /></div>
          <p className="media-note">{mediaNote}</p>
        </section>
      )}

      {stage === "battle" && (
        <section className="battle-screen">
          <div className="battle-heading">
            <div>
              <span className="round-chip">ROUND {round + 1}</span>
              <p>MATCH FOUND · {rival.place.toUpperCase()}</p>
            </div>
            <div className={`timer ${isRecording ? "timer--live" : ""}`}>
              <span>{timeLeft}</span><small>SEC</small>
            </div>
            <div className="judge-chip"><span>●</span> BARK JUDGE ONLINE</div>
          </div>

          <div className="prompt-card" style={{ "--prompt": prompt.color } as React.CSSProperties}>
            <div className="prompt-emoji">{prompt.emoji}</div>
            <div><small>YOUR BARK PROMPT</small><h2>{prompt.title}</h2><p>{prompt.cue}</p></div>
            <div className="judge-brief"><small>JUDGED ON</small><strong>{prompt.judge}</strong></div>
          </div>

          <div className="battle-grid">
            <article className="player-card player-card--you">
              <div className="video-frame">
                {micReady && hasVideo ? (
                  <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
                ) : (
                  <div className="video-fallback">🐶<small>{mediaNote}</small></div>
                )}
                <span className="player-tag">YOU · {rating} ELO</span>
                {isRecording && <span className="live-chip"><i /> LIVE</span>}
              </div>
              <Waveform values={wave} active={isRecording} color={prompt.color} />
              <div className="player-meta"><strong>YOU</strong><span>THE UNDERDOG</span></div>
            </article>

            <div className="battle-vs">
              <span>VS</span><i />
            </div>

            <article className="player-card player-card--rival">
              <div className="video-frame rival-frame">
                <div className="rival-glow" />
                <div className="rival-face">{rival.face}</div>
                <span className="player-tag">{rival.place.toUpperCase()}</span>
                <span className="demo-chip">DEMO RIVAL</span>
              </div>
              <Waveform values={opponentWave} active={isRecording} color="#b8ec57" />
              <div className="player-meta"><strong>{rival.name}</strong><span>{rival.breed}</span></div>
            </article>
          </div>

          <div className="record-panel">
            {!isRecording && !score ? (
              <button className="bark-button" onClick={startRecording}>
                <span className="bark-rings" /><PawMark /><strong>START BARKING</strong><small>10 SECOND ROUND</small>
              </button>
            ) : isRecording ? (
              <button className="stop-button" onClick={stopRecording}>
                <span className="record-dot" /><strong>BARKING NOW</strong><small>Tap to finish early</small>
              </button>
            ) : (
              <div className="judging-state"><span>✦</span><strong>THE PACK IS JUDGING...</strong></div>
            )}
            <p>{isRecording ? "Give it everything. Peaks, tone, and rhythm are being measured." : "Headphones recommended · Please do not alarm the neighbors"}</p>
          </div>
        </section>
      )}

      {stage === "results" && score && rivalScore && (
        <section className="results-screen">
          <div className="confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <p className="kicker">THE PACK HAS SPOKEN</p>
          <h2 className={winner ? "win-title" : "loss-title"}>{winner ? "TOP DOG!" : "SO CLOSE!"}</h2>
          <p className="result-sub">{winner ? `You out-barked ${rival.name}. Absolutely unleashed.` : `${rival.name} took this one. Your comeback arc starts now.`}</p>

          <div className="scoreboard">
            <div className={`result-player ${winner ? "result-player--winner" : ""}`}>
              <div className="result-avatar">🐶</div>
              <span>YOU</span>
              <strong>{score.total}</strong>
              <small>+{winner ? 14 : 0} ELO</small>
            </div>
            <div className="score-divider"><span>FINAL</span><b>—</b></div>
            <div className={`result-player ${!winner ? "result-player--winner" : ""}`}>
              <div className="result-avatar">{rival.face}</div>
              <span>{rival.name}</span>
              <strong>{rivalScore.total}</strong>
              <small>{rival.rating} ELO</small>
            </div>
          </div>

          <div className="score-breakdown">
            {[
              ["POWER", score.power, rivalScore.power],
              ["CONTROL", score.control, rivalScore.control],
              ["CHARACTER", score.character, rivalScore.character],
            ].map(([label, yours, theirs]) => (
              <div key={label as string}>
                <strong>{yours}</strong>
                <span className="score-track"><i style={{ width: `${yours}%` }} /><b style={{ width: `${theirs}%` }} /></span>
                <small>{label}</small>
                <strong>{theirs}</strong>
              </div>
            ))}
          </div>

          <div className="result-actions">
            <button className="primary-button" onClick={newRound}><span>BARK AGAIN</span><b>↻</b></button>
            <button className="secondary-button" onClick={() => setStage("leaderboard")}>VIEW LEADERBOARD</button>
          </div>
          <p className="rating-note">NEW RATING <strong>{rating}</strong> · RANK #{userRank}</p>
        </section>
      )}

      {stage === "leaderboard" && (
        <section className="leaderboard-screen">
          <div className="leaderboard-title">
            <div><p className="kicker">GLOBAL PACK RANKINGS</p><h2>THE BIG DOGS.</h2></div>
            <button className="primary-button compact" onClick={enterArena}><span>ENTER ARENA</span><b>→</b></button>
          </div>
          <div className="season-card">
            <div><span>SEASON 01</span><strong>THE SUMMER OF BARK</strong></div>
            <p><b>6D 14H</b> until ranks lock</p>
          </div>
          <div className="leaderboard-table">
            <div className="leaderboard-row table-head"><span>RANK</span><span>PUP</span><span>FORM</span><span>ELO</span></div>
            {leaderboard.map((dog) => (
              <div className="leaderboard-row" key={dog.rank}>
                <span className={`rank rank--${dog.rank}`}>{dog.rank}</span>
                <span className="leader-dog"><i>{dog.face}</i><b>{dog.name}<small>{dog.tag}</small></b></span>
                <span className="form"><i>W</i><i>W</i><i className="loss">L</i><i>W</i><i>W</i></span>
                <span className="elo"><b>{dog.elo}</b><small>{dog.delta}</small></span>
              </div>
            ))}
            <div className="leaderboard-row you-row">
              <span className="rank">{userRank}</span>
              <span className="leader-dog"><i>🐶</i><b>You<small>THE UNDERDOG</small></b></span>
              <span className="form"><i>W</i><i className="loss">L</i><i>W</i><i>W</i><i>W</i></span>
              <span className="elo"><b>{rating}</b><small>LIVE</small></span>
            </div>
          </div>
          <p className="board-footnote">Win bark-offs to climb the pack. Ratings are saved on this device.</p>
        </section>
      )}

      <footer>
        <span>BARKOFF © 2026</span>
        <span>BUILT WITH <b>♥</b> FOR CORGI HACKS</span>
        <span>NO DOGS WERE JUDGED. HUMANS, HOWEVER...</span>
      </footer>
    </main>
  );
}
