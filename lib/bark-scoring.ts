export type BarkFeatures = {
  loudness: number;
  peak: number;
  dynamics: number;
  activity: number;
  silence: number;
  attackRate: number;
  rhythm: number;
  sustain: number;
  pitchHeight: number;
  pitchRange: number;
  pitchRise: number;
  pitchStability: number;
  brightness: number;
  roughness: number;
  depth: number;
};

export type BarkFeatureKey = keyof BarkFeatures;

export type BarkScore = {
  total: number;
  power: number;
  control: number;
  character: number;
  moodFit: number;
  feedback: string[];
};

type MoodCriterion = {
  feature: BarkFeatureKey;
  target: number;
  tolerance: number;
  weight: number;
  success: string;
  improve: string;
};

export type BarkPrompt = {
  title: string;
  cue: string;
  emoji: string;
  judge: string;
  color: string;
  componentWeights: [number, number, number];
  criteria: MoodCriterion[];
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const criterion = (
  feature: BarkFeatureKey,
  target: number,
  tolerance: number,
  weight: number,
  success: string,
  improve: string,
): MoodCriterion => ({ feature, target, tolerance, weight, success, improve });

export const barkPrompts: BarkPrompt[] = [
  {
    title: "The Joy Bark",
    cue: "Your human just came home after 100 years.",
    emoji: "🥹",
    judge: "Bright tone · rising finish · bubbly attacks",
    color: "#ffcc4d",
    componentWeights: [0.25, 0.15, 0.6],
    criteria: [
      criterion("pitchRise", 0.85, 0.55, 1.2, "That rising finish sounded genuinely thrilled.", "Let the pitch climb toward the end."),
      criterion("brightness", 0.75, 0.6, 1, "Your tone had a joyful sparkle.", "Use a brighter, lighter vocal tone."),
      criterion("attackRate", 0.55, 0.5, 0.8, "The eager little bursts sold the excitement.", "Add a few eager, distinct bark bursts."),
      criterion("activity", 0.72, 0.55, 0.8, "You kept the reunion energy alive.", "Stay vocally active through more of the round."),
      criterion("dynamics", 0.58, 0.5, 0.7, "Your changing energy felt expressive.", "Give the bark a bigger emotional build."),
    ],
  },
  {
    title: "Tiny But Terrifying",
    cue: "You weigh six pounds. Act like you own the block.",
    emoji: "😤",
    judge: "Big power · hard attacks · fearless pressure",
    color: "#ff735c",
    componentWeights: [0.65, 0.15, 0.2],
    criteria: [
      criterion("loudness", 0.86, 0.58, 1.2, "You projected serious block-boss energy.", "Push more air and commit to the volume."),
      criterion("peak", 0.92, 0.55, 1, "Your strongest hits landed with authority.", "Give the attacks a harder peak."),
      criterion("attackRate", 0.72, 0.55, 0.9, "Those attacks felt confrontational.", "Use sharper, more frequent attacks."),
      criterion("activity", 0.84, 0.5, 0.8, "There was no hesitation in that challenge.", "Hold the pressure for more of the round."),
      criterion("roughness", 0.62, 0.55, 0.7, "The grit made you sound dangerous.", "Add a little growl or vocal grit."),
    ],
  },
  {
    title: "The Dramatic Whimper",
    cue: "Dinner is seventeen seconds late. Devastating.",
    emoji: "🥺",
    judge: "High pleading tone · restraint · emotional bends",
    color: "#b69cff",
    componentWeights: [0.1, 0.35, 0.55],
    criteria: [
      criterion("loudness", 0.28, 0.4, 1, "The restraint made the tragedy believable.", "Pull the volume back and sound more helpless."),
      criterion("pitchHeight", 0.82, 0.55, 1.1, "That high pleading register was heartbreaking.", "Move into a higher, more pleading register."),
      criterion("pitchRange", 0.66, 0.55, 1, "The pitch bends delivered real emotional damage.", "Bend and vary the pitch more."),
      criterion("dynamics", 0.64, 0.5, 0.9, "Your swells and fades felt theatrical.", "Shape the whimper with clearer swells and fades."),
      criterion("attackRate", 0.24, 0.35, 0.7, "The sparse delivery made every plea count.", "Leave more space between each plea."),
    ],
  },
  {
    title: "Moonlight Howl",
    cue: "Call the whole pack. Make it cinematic.",
    emoji: "🌕",
    judge: "Long sustain · stable pitch · smooth finish",
    color: "#79d8ff",
    componentWeights: [0.25, 0.55, 0.2],
    criteria: [
      criterion("sustain", 0.94, 0.48, 1.3, "That long sustain could summon the whole pack.", "Hold one continuous howl much longer."),
      criterion("pitchStability", 0.9, 0.48, 1.2, "Your pitch stayed impressively centered.", "Keep the main note steadier."),
      criterion("attackRate", 0.08, 0.28, 0.8, "One clean entrance made it cinematic.", "Use one strong entrance instead of repeated barks."),
      criterion("activity", 0.8, 0.55, 0.8, "You carried the note through the scene.", "Keep the howl present for more of the timer."),
      criterion("dynamics", 0.3, 0.38, 0.7, "The smooth envelope sounded controlled.", "Smooth out sudden volume jumps."),
    ],
  },
  {
    title: "Rapid-Fire Yaps",
    cue: "The mail carrier has entered your jurisdiction.",
    emoji: "📦",
    judge: "Fast attacks · clean rhythm · bright urgency",
    color: "#b8ec57",
    componentWeights: [0.25, 0.25, 0.5],
    criteria: [
      criterion("attackRate", 0.96, 0.5, 1.3, "That yap rate was properly unreasonable.", "Fit more distinct yaps into each second."),
      criterion("rhythm", 0.86, 0.55, 1, "Your yap rhythm stayed locked in.", "Space the yaps more consistently."),
      criterion("sustain", 0.14, 0.3, 0.8, "The short attacks stayed crisp.", "Shorten each yap instead of sustaining it."),
      criterion("brightness", 0.76, 0.55, 0.8, "The bright tone sounded wonderfully urgent.", "Use a sharper, brighter yap tone."),
      criterion("activity", 0.82, 0.5, 0.8, "You defended the jurisdiction relentlessly.", "Keep the yap barrage going."),
    ],
  },
  {
    title: "The Sneaky Boof",
    cue: "You heard something downstairs. Probably a sock.",
    emoji: "🕵️",
    judge: "Suspenseful silence · one low hit · restraint",
    color: "#f4a4e3",
    componentWeights: [0.1, 0.65, 0.25],
    criteria: [
      criterion("silence", 0.68, 0.45, 1.2, "The silence built excellent sock-related suspense.", "Leave more tense silence before the boof."),
      criterion("attackRate", 0.14, 0.28, 1, "You chose your moment instead of overbarking.", "Use one or two deliberate hits only."),
      criterion("peak", 0.58, 0.48, 0.8, "The boof landed without blowing your cover.", "Give the main boof a clearer but controlled peak."),
      criterion("depth", 0.72, 0.55, 1, "That low resonance sounded properly suspicious.", "Move the boof lower into your chest."),
      criterion("sustain", 0.16, 0.3, 0.7, "The short finish kept it stealthy.", "Cut the boof off more quickly."),
    ],
  },
  {
    title: "Doorbell Defender",
    cue: "A package arrived. Civilization depends on you.",
    emoji: "🚪",
    judge: "Relentless pressure · repeated hits · guard-dog grit",
    color: "#ff9f43",
    componentWeights: [0.55, 0.2, 0.25],
    criteria: [
      criterion("loudness", 0.82, 0.58, 1, "The whole house definitely heard that warning.", "Project the warning more forcefully."),
      criterion("attackRate", 0.78, 0.55, 1.1, "Your repeated hits sounded properly defensive.", "Use more repeated, distinct warning barks."),
      criterion("rhythm", 0.66, 0.6, 0.8, "The attack pattern felt intentional.", "Settle into a more repeatable guard-dog rhythm."),
      criterion("roughness", 0.66, 0.55, 0.9, "The grit added convincing guard-dog authority.", "Add more roughness to the warning."),
      criterion("activity", 0.86, 0.5, 0.8, "You guarded the door without taking a shift break.", "Maintain the warning for more of the round."),
    ],
  },
  {
    title: "The Puppy Question",
    cue: "You are absolutely sure that treat was for you... right?",
    emoji: "❓",
    judge: "Rising pitch · bright curiosity · concise phrasing",
    color: "#68e0cf",
    componentWeights: [0.1, 0.3, 0.6],
    criteria: [
      criterion("pitchRise", 0.94, 0.48, 1.3, "That upward finish sounded like a real question.", "Make the pitch rise more clearly at the end."),
      criterion("pitchHeight", 0.78, 0.55, 1, "The high register felt adorably uncertain.", "Use a slightly higher, more curious voice."),
      criterion("brightness", 0.76, 0.55, 0.9, "Your bright tone sold the puppy curiosity.", "Lighten and brighten the tone."),
      criterion("sustain", 0.28, 0.38, 0.7, "The concise phrasing sounded conversational.", "Keep each questioning sound shorter."),
      criterion("dynamics", 0.56, 0.5, 0.7, "The changing emphasis made it expressive.", "Shape the question with more vocal movement."),
    ],
  },
  {
    title: "Sleepy Grumble",
    cue: "Someone moved your blanket three whole inches.",
    emoji: "😴",
    judge: "Low pitch · chest resonance · lazy vocal fry",
    color: "#9ea7ff",
    componentWeights: [0.25, 0.45, 0.3],
    criteria: [
      criterion("pitchHeight", 0.16, 0.38, 1.2, "That low register sounded magnificently grumpy.", "Drop the grumble into a lower register."),
      criterion("depth", 0.9, 0.52, 1.2, "The chest resonance had excellent blanket energy.", "Bring more low-frequency chest resonance."),
      criterion("loudness", 0.36, 0.42, 0.8, "You sounded annoyed without becoming energetic.", "Keep it quieter and sleepier."),
      criterion("roughness", 0.78, 0.55, 1, "The vocal fry made the grumble convincing.", "Add more textured vocal fry or grit."),
      criterion("attackRate", 0.16, 0.3, 0.7, "The lazy pacing felt appropriately exhausted.", "Slow down and use fewer attacks."),
    ],
  },
  {
    title: "Opera Pup",
    cue: "The balcony is full. Deliver your impossible finale.",
    emoji: "🎭",
    judge: "Heroic sustain · centered pitch · graceful vibrato",
    color: "#ff87bd",
    componentWeights: [0.25, 0.5, 0.25],
    criteria: [
      criterion("sustain", 0.95, 0.48, 1.3, "You held the finale like a seasoned diva.", "Hold the main note for much longer."),
      criterion("pitchStability", 0.84, 0.5, 1.1, "The note stayed centered under pressure.", "Center the pitch and reduce large wobbles."),
      criterion("pitchRange", 0.34, 0.36, 0.8, "The controlled pitch movement resembled vibrato.", "Add a little controlled pitch movement."),
      criterion("loudness", 0.62, 0.52, 0.8, "Your projection reached the imaginary balcony.", "Project the finale more confidently."),
      criterion("activity", 0.84, 0.5, 0.8, "You committed to the full operatic phrase.", "Carry the phrase through more of the timer."),
    ],
  },
];

const featureKeys = [
  "loudness",
  "peak",
  "dynamics",
  "activity",
  "silence",
  "attackRate",
  "rhythm",
  "sustain",
  "pitchHeight",
  "pitchRange",
  "pitchRise",
  "pitchStability",
  "brightness",
  "roughness",
  "depth",
] as const satisfies readonly BarkFeatureKey[];

export function parseBarkFeatures(value: unknown): BarkFeatures | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed = {} as BarkFeatures;
  for (const key of featureKeys) {
    const numeric = Number(record[key]);
    if (!Number.isFinite(numeric)) return null;
    parsed[key] = clamp(numeric);
  }
  return parsed;
}

export function parseBarkScore(value: unknown): BarkScore | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const numericKeys = ["total", "power", "control", "character", "moodFit"] as const;
  const numeric = Object.fromEntries(
    numericKeys.map((key) => [key, Math.round(clamp(Number(record[key]) / 100) * 100)]),
  ) as Record<(typeof numericKeys)[number], number>;
  if (numericKeys.some((key) => !Number.isFinite(Number(record[key])))) return null;
  const feedback = Array.isArray(record.feedback)
    ? record.feedback.filter((item): item is string => typeof item === "string").slice(0, 3)
    : [];
  return { ...numeric, feedback };
}

function componentScore(features: BarkFeatures) {
  const power = Math.round(
    100 *
      (features.loudness * 0.36 +
        features.peak * 0.24 +
        features.attackRate * 0.16 +
        features.depth * 0.12 +
        features.activity * 0.12),
  );
  const control = Math.round(
    100 *
      (features.sustain * 0.28 +
        features.pitchStability * 0.25 +
        features.rhythm * 0.18 +
        (1 - features.dynamics) * 0.14 +
        features.activity * 0.15),
  );
  const character = Math.round(
    100 *
      (features.dynamics * 0.2 +
        features.pitchRange * 0.18 +
        features.brightness * 0.16 +
        features.roughness * 0.16 +
        features.attackRate * 0.16 +
        features.depth * 0.14),
  );
  return {
    power: Math.round(clamp(power / 100, 0.05, 0.99) * 100),
    control: Math.round(clamp(control / 100, 0.05, 0.99) * 100),
    character: Math.round(clamp(character / 100, 0.05, 0.99) * 100),
  };
}

export function scoreBark(features: BarkFeatures, promptIndex: number): BarkScore {
  const prompt = barkPrompts[Math.abs(Math.trunc(promptIndex)) % barkPrompts.length];
  const judged = prompt.criteria.map((item) => ({
    ...item,
    fit: clamp(1 - Math.abs(features[item.feature] - item.target) / item.tolerance),
  }));
  const totalCriterionWeight = judged.reduce((sum, item) => sum + item.weight, 0);
  const moodFit = Math.round(
    100 *
      judged.reduce((sum, item) => sum + item.fit * item.weight, 0) /
      totalCriterionWeight,
  );
  const components = componentScore(features);
  const weightedComponents =
    components.power * prompt.componentWeights[0] +
    components.control * prompt.componentWeights[1] +
    components.character * prompt.componentWeights[2];
  const audioEvidence = Math.max(
    features.activity,
    features.peak * 0.75,
    features.loudness * 0.8,
  );
  const effortGate = clamp(0.55 + audioEvidence * 0.6, 0.55, 1);
  const total = Math.round(
    clamp(((moodFit * 0.6 + weightedComponents * 0.4) * effortGate) / 100, 0.05, 0.99) *
      100,
  );

  const ranked = [...judged].sort((left, right) => right.fit - left.fit);
  const strengths = ranked
    .slice(0, 2)
    .map((item) => (item.fit >= 0.58 ? item.success : item.improve));
  const weakest = ranked.at(-1);
  const feedback = [
    ...strengths,
    ...(weakest ? [`Next round: ${weakest.improve}`] : []),
  ].slice(0, 3);

  return {
    total,
    ...components,
    moodFit: Math.round(clamp(moodFit / 100, 0.05, 0.99) * 100),
    feedback,
  };
}
