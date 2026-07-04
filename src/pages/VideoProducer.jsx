import { useState, useEffect, useRef } from "react";
import { translateScript, generatePrompts, submitImages, checkJobs, submitAnimations, checkCost, saveToAirtable, assembleVideo, checkAssemblyStatus, getUrlLog } from "../lib/api";

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_CHANNELS = [
  { id: "woh", name: "A World of Horses", style: "cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical", kling_style: "slow, cinematic, warm and atmospheric", preset: true },
  { id: "bof", name: "Business of Our Father", style: "cinematic film grain, rich gold and black tones, dramatic biblical lighting, photorealistic, 9:16 vertical", kling_style: "slow, dramatic, biblical and majestic", preset: true },
  { id: "mmm", name: "Mystery Mile Marker", style: "cinematic film grain, dark dramatic lighting, deep shadows, mysterious atmosphere, photorealistic, 9:16 vertical", kling_style: "slow, eerie, suspenseful", preset: true },
  { id: "lmm", name: "La Milla Misteriosa", style: "cinematic film grain, dark dramatic lighting, deep shadows, mysterious atmosphere, photorealistic, 9:16 vertical", kling_style: "slow, eerie, suspenseful", preset: true, defaultLang: "es" },
  { id: "cuf", name: "Chicago Underworld Files", style: "cinematic film grain, noir black and white with amber highlights, 1920s-1950s era, photorealistic, 9:16 vertical", kling_style: "slow, gritty, noir and cinematic", preset: true },
  { id: "sdu", name: "San Diego Uncovered", style: "cinematic film grain, warm California golden light, sun-drenched coastal tones, photorealistic, 9:16 vertical", kling_style: "slow, warm, sun-drenched and historical", preset: true },
  { id: "mbl", name: "My Bilingual Life", style: "cinematic film grain, bright warm classroom tones, inviting educational feel, photorealistic, 9:16 vertical", kling_style: "gentle, warm, friendly and educational", preset: true },
  { id: "nnp", name: "El Negocio de Nuestro Padre", style: "cinematic film grain, rich gold and black tones, dramatic biblical lighting, photorealistic, 9:16 vertical", kling_style: "slow, dramatic, biblical and majestic", preset: true, defaultLang: "es" },
  { id: "other", name: "✦ Other / Client Work", style: "", kling_style: "", preset: true, isOther: true },
];

const STYLE_MOODS = [
  { id: "warm", label: "Warm & Natural", style: "cinematic film grain, muted warm golden tones, shallow depth of field, photorealistic, 9:16 vertical", kling_style: "slow, warm, natural and cinematic" },
  { id: "dark", label: "Dark & Dramatic", style: "cinematic film grain, dark dramatic lighting, deep shadows, moody atmosphere, photorealistic, 9:16 vertical", kling_style: "slow, dramatic, dark and moody" },
  { id: "bright", label: "Bright & Uplifting", style: "cinematic film grain, bright warm tones, airy and optimistic feel, photorealistic, 9:16 vertical", kling_style: "gentle, bright, uplifting and warm" },
  { id: "noir", label: "Noir / Historical", style: "cinematic film grain, noir black and white with amber highlights, vintage era, photorealistic, 9:16 vertical", kling_style: "slow, gritty, noir and historical" },
  { id: "epic", label: "Epic & Cinematic", style: "cinematic film grain, rich dramatic tones, sweeping epic feel, photorealistic, 9:16 vertical", kling_style: "slow, sweeping, epic and powerful" },
  { id: "custom", label: "Custom style...", style: "", kling_style: "" },
];

const QUALITY_TIERS = [
  {
    id: "fast",
    label: "⚡ Fast",
    desc: "Quick turnaround, great for drafts",
    imageModel: "nano_banana_flash",
    imageName: "Nano Banana Flash",
    videoModel: "kling3_0_turbo",
    videoName: "Kling 3.0 Turbo",
    approxCredits: "~14",
  },
  {
    id: "standard",
    label: "⭐ Standard",
    desc: "Best balance of quality and speed",
    imageModel: "nano_banana_2",
    imageName: "Nano Banana 2",
    videoModel: "kling3_0_turbo",
    videoName: "Kling 3.0 Turbo",
    approxCredits: "~19.5",
    default: true,
  },
  {
    id: "premium",
    label: "💎 Premium",
    desc: "Highest quality output",
    imageModel: "cinematic_studio_2_5",
    imageName: "Cinema Studio 2.5",
    videoModel: "kling3_0",
    videoName: "Kling 3.0",
    approxCredits: "~42",
  },
];

const ALL_IMAGE_MODELS = [
  { id: "nano_banana_flash", name: "Nano Banana Flash", credits: 0.8, desc: "Fastest generation, good for quick iterations" },
  { id: "nano_banana_2", name: "Nano Banana 2", credits: 1.5, desc: "Cinematic stills, excellent quality/speed balance" },
  { id: "gpt_image_2", name: "GPT Image 2", credits: 2.0, desc: "Excellent detail and text rendering" },
  { id: "seedream_v4_5", name: "Seedream 4.5", credits: 2.5, desc: "Best for character consistency across scenes" },
  { id: "seedream_v5_lite", name: "Seedream 5.0 Lite", credits: 3.0, desc: "Upgraded character & scene consistency" },
  { id: "cinematic_studio_2_5", name: "Cinema Studio Image 2.5", credits: 4.0, desc: "Highest quality cinematic output" },
];

const ALL_VIDEO_MODELS = [
  { id: "kling3_0_turbo", name: "Kling 3.0 Turbo", credits: 7.5, desc: "Fast animation, great motion quality" },
  { id: "kling3_0", name: "Kling 3.0", credits: 10.0, desc: "Higher quality, slightly slower" },
  { id: "seedance_2_0", name: "Seedance 2.0", credits: 9.0, desc: "Fluid motion, great for character animation" },
  { id: "cinematic_studio_video_v2", name: "Cinema Studio Video 2", credits: 12.0, desc: "Cinematic motion, high detail" },
  { id: "cinematic_studio_3_0", name: "Cinema Studio Video 3.0", credits: 14.0, desc: "Premium quality, most realistic motion" },
];

const STEPS = [
  { id: 1, label: "Channel & Script" },
  { id: 2, label: "Spanish Review" },
  { id: 3, label: "Scene Prompts" },
  { id: 4, label: "Approve Images" },
  { id: 5, label: "Approve Animation" },
  { id: 6, label: "Save & Done" },
];

const MOCK_PROMPTS = [
  "A chestnut thoroughbred with a white blaze surges mid-gallop on a racetrack, powerful and fast. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "Close-up of a bandaged leg, a vet's hands carefully unwrapping it, warm barn light. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "A chestnut horse taking first careful steps in recovery, lead rope through a sunny paddock. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "A small child in a riding helmet sitting gently on a chestnut horse, completely calm. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "Close-up portrait of a chestnut thoroughbred looking directly at camera, eyes deep and knowing. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "The horse standing calmly as several children gather around him, golden afternoon light. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "A child brushing the horse's mane, both at ease, warm barn glow. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
  "Wide shot of the horse standing peacefully in a green paddock at golden hour, fully healed. cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical",
];

const MOCK_IMAGES = [
  "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1560807707-8cc77767d783?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1534773728080-33d31da27ae5?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1452378174528-3090a4bba7b2?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1643297654416-05795d62e39c?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1551884170-09fb70a3a2ed?w=400&h=711&fit=crop",
  "https://images.unsplash.com/photo-1504075272324-4ea0b5c3dc73?w=400&h=711&fit=crop",
];

const MOCK_SPANISH = `El veterinario dijo que nunca volvería a correr.\n\nQue quizás ni siquiera podría caminar sin cojear.\n\nLa fractura era tan grave que la mayoría de los caballos en su situación son sacrificados.\n\nSu dueña dijo que no.\n\nSu nombre era Corridor Key — un pura sangre que se fracturó el hueso de la cuartilla durante una carrera en dos mil nueve.\n\nLa cirugía duró horas.\n\nLa recuperación duró años.\n\nHubo contratiempos. Infecciones. Semanas en las que parecía que el veterinario había tenido razón.\n\nPero su dueña nunca se rindió con él.\n\nY lentamente — imposiblemente —\n\nCorridor Key sanó.\n\nNunca volvió a correr.\n\nPero hizo algo que el veterinario no había predicho en absoluto.\n\nSe convirtió en caballo de terapia.\n\nSi esa historia significa algo para ti, síguenos — hay más como esta aquí todos los días.`;

// ─── Style Helpers ────────────────────────────────────────────────────────────

const Label = ({ children, style: s }) => (
  <div style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "10px", ...s }}>
    {children}
  </div>
);

const inputStyle = {
  width: "100%", padding: "12px 16px", borderRadius: "10px",
  border: "2px solid #2A2D3A", background: "#1A1D27",
  color: "#E8E8E8", fontSize: "14px", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};

const primaryBtn = (disabled) => ({
  padding: "14px 28px", borderRadius: "10px", border: "none",
  background: disabled ? "#2A2D3A" : "linear-gradient(135deg, #C9973A, #E8B85A)",
  color: disabled ? "#4B5563" : "#0F1117",
  fontSize: "14px", fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  display: "inline-flex", alignItems: "center", gap: "8px",
  transition: "all 0.2s",
});

const ghostBtn = {
  padding: "14px 20px", borderRadius: "10px", border: "2px solid #2A2D3A",
  background: "transparent", color: "#9CA3AF", fontSize: "14px", cursor: "pointer",
};

const summaryBadge = (color) => ({
  padding: "8px 16px", borderRadius: "20px",
  background: `${color}20`, border: `1px solid ${color}50`,
  color, fontSize: "13px", fontWeight: 600,
});

const card = (active) => ({
  padding: "12px 14px", borderRadius: "10px",
  border: active ? "2px solid #C9973A" : "2px solid #2A2D3A",
  background: active ? "rgba(201,151,58,0.08)" : "#1A1D27",
  color: active ? "#C9973A" : "#9CA3AF",
  fontSize: "12px", fontWeight: active ? 600 : 400,
  cursor: "pointer", textAlign: "left", transition: "all 0.2s",
});

// ─── Add Channel Screen ───────────────────────────────────────────────────────

function AddChannelScreen({ onSave, onCancel, customChannels }) {
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [mood, setMood] = useState("");
  const [customStyle, setCustomStyle] = useState("");
  const [defaultLang, setDefaultLang] = useState("both");
  const [airtableBase, setAirtableBase] = useState("");
  const [airtableTable, setAirtableTable] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedMood = STYLE_MOODS.find(m => m.id === mood);
  const isValid = name.trim() && niche.trim() && mood && (mood !== "custom" || customStyle.trim());

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      const newChannel = {
        id: `custom_${Date.now()}`,
        name: name.trim(),
        niche: niche.trim(),
        style: mood === "custom" ? customStyle.trim() : selectedMood.style,
        kling_style: mood === "custom" ? "slow, cinematic" : selectedMood.kling_style,
        defaultLang,
        airtableBase: airtableBase.trim(),
        airtableTable: airtableTable.trim(),
        preset: false,
        addedOn: new Date().toLocaleDateString(),
      };
      setSaving(false);
      onSave(newChannel);
    }, 1200);
  };

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "0 32px 40px", animation: "fadeIn 0.3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
        <button onClick={onCancel} style={{ ...ghostBtn, padding: "8px 14px", fontSize: "13px" }}>← Back</button>
        <div>
          <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px" }}>Add a Channel</div>
          <div style={{ color: "#6B7280", fontSize: "14px" }}>This channel will appear in the channel selector for all producers.</div>
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <Label>Channel Name</Label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Austin Food Scene, Daily Devotionals..." style={inputStyle} />
      </div>

      <div style={{ marginBottom: "20px" }}>
        <Label>Niche / Topic</Label>
        <input value={niche} onChange={e => setNiche(e.target.value)} placeholder="e.g. local food culture, biblical devotionals, true crime history..." style={inputStyle} />
        <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "6px" }}>Helps Claude write better scene prompts for this channel's content.</div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <Label>Visual Style</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {STYLE_MOODS.map(m => (
            <button key={m.id} onClick={() => setMood(m.id)} style={card(mood === m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {mood && mood !== "custom" && (
          <div style={{ marginTop: "10px", padding: "10px 14px", background: "#1A1D27", borderRadius: "8px", border: "1px solid #2A2D3A" }}>
            <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "4px" }}>Style anchor preview:</div>
            <div style={{ fontSize: "12px", color: "#9CA3AF", fontStyle: "italic" }}>{selectedMood?.style}</div>
          </div>
        )}
        {mood === "custom" && (
          <div style={{ marginTop: "10px" }}>
            <textarea value={customStyle} onChange={e => setCustomStyle(e.target.value)} placeholder="e.g. cinematic film grain, warm sunset tones, shallow depth of field, photorealistic, 9:16 vertical" rows={3} style={{ ...inputStyle, resize: "vertical", fontSize: "13px" }} />
            <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "4px" }}>Always end with: photorealistic, 9:16 vertical</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "20px" }}>
        <Label>Default Language Output</Label>
        <div style={{ display: "flex", gap: "10px" }}>
          {[
            { id: "en", label: "🇺🇸 English only" },
            { id: "both", label: "🇺🇸 + 🇪🇸 Both" },
            { id: "es", label: "🇪🇸 Spanish only" },
          ].map(opt => (
            <button key={opt.id} onClick={() => setDefaultLang(opt.id)} style={{ ...card(defaultLang === opt.id), padding: "10px 16px" }}>
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "6px" }}>Can be changed per video — this is just the default.</div>
      </div>

      <div style={{ background: "#1A1D27", border: "2px solid #2A2D3A", borderRadius: "12px", padding: "18px 20px", marginBottom: "28px" }}>
        <div style={{ fontSize: "13px", color: "#9CA3AF", fontWeight: 600, marginBottom: "14px" }}>
          Airtable Integration <span style={{ fontWeight: 400, color: "#4B5563" }}>(optional)</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <Label>Base ID</Label>
            <input value={airtableBase} onChange={e => setAirtableBase(e.target.value)} placeholder="appXXXXXXXXXXXXXX" style={{ ...inputStyle, fontSize: "13px" }} />
          </div>
          <div>
            <Label>Table ID</Label>
            <input value={airtableTable} onChange={e => setAirtableTable(e.target.value)} placeholder="tblXXXXXXXXXXXXXX" style={{ ...inputStyle, fontSize: "13px" }} />
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "8px" }}>
          If provided, completed videos will save scene URLs and status to this table.
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={handleSave} disabled={!isValid || saving} style={primaryBtn(!isValid || saving)}>
          {saving ? "Saving channel..." : "Save Channel →"}
        </button>
      </div>
    </div>
  );
}

// ─── Job Log Screen ───────────────────────────────────────────────────────────

function JobLogScreen({ jobs, onClose }) {
  const totalCredits = jobs.reduce((sum, j) => sum + j.credits, 0);
  const twilaCredits = jobs.filter(j => j.producer === "Twila").reduce((sum, j) => sum + j.credits, 0);
  const genesisCredits = jobs.filter(j => j.producer === "Genesis").reduce((sum, j) => sum + j.credits, 0);

  const exportCSV = () => {
    const headers = ["Title", "Channel", "Client", "Language", "Producer", "Image Model", "Video Model", "Credits Used", "Date"];
    const rows = jobs.map(j => [
      j.title || "", j.channel || "", j.client || "",
      j.language === "both" ? "EN + ES" : j.language === "es" ? "ES" : "EN",
      j.producer || "", j.imageModel || "", j.videoModel || "", j.credits || "", j.date || "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `videoforge-jobs-${new Date().toLocaleDateString("en-US").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 32px 40px", animation: "fadeIn 0.3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px" }}>Job Log</div>
          <div style={{ color: "#6B7280", fontSize: "14px" }}>All videos produced through VideoForge</div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {jobs.length > 0 && (
            <button onClick={exportCSV} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid rgba(201,151,58,0.4)", background: "rgba(201,151,58,0.08)", color: "#C9973A", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              ↓ Export CSV
            </button>
          )}
          <button onClick={onClose} style={{ ...ghostBtn, padding: "8px 16px", fontSize: "13px" }}>← Back</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "28px" }}>
        {[
          { label: "Total Credits Used", value: totalCredits.toFixed(1), sub: `~$${(totalCredits * 0.0625).toFixed(2)}`, color: "#C9973A" },
          { label: "Twila", value: twilaCredits.toFixed(1), sub: `~$${(twilaCredits * 0.0625).toFixed(2)}`, color: "#6366F1" },
          { label: "Genesis", value: genesisCredits.toFixed(1), sub: `~$${(genesisCredits * 0.0625).toFixed(2)}`, color: "#22C55E" },
        ].map(stat => (
          <div key={stat.label} style={{ background: "#1A1D27", border: "2px solid #2A2D3A", borderRadius: "12px", padding: "18px 20px" }}>
            <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>{stat.label}</div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: stat.color, letterSpacing: "-0.5px" }}>{stat.value}</div>
            <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "4px" }}>{stat.sub} @ $0.0625/credit</div>
          </div>
        ))}
      </div>

      {jobs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#4B5563" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>📋</div>
          <div style={{ fontSize: "16px" }}>No jobs yet</div>
          <div style={{ fontSize: "14px", marginTop: "6px" }}>Completed videos will appear here automatically</div>
        </div>
      ) : (
        <div style={{ background: "#1A1D27", borderRadius: "12px", border: "2px solid #2A2D3A", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 0.8fr", padding: "12px 20px", borderBottom: "1px solid #2A2D3A", fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            <div>Title</div><div>Channel</div><div>Language</div><div>Producer</div><div>Credits</div><div>Date</div>
          </div>
          {jobs.map((job, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 0.8fr 0.8fr", padding: "14px 20px", borderBottom: i < jobs.length - 1 ? "1px solid #1E2130" : "none", fontSize: "13px" }}>
              <div style={{ color: "#E8E8E8", fontWeight: 500 }}>
                {job.title}
                {job.client && <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>Client: {job.client}</div>}
              </div>
              <div style={{ color: "#9CA3AF" }}>{job.channel}</div>
              <div>{job.language === "both" ? <span>🇺🇸🇪🇸</span> : job.language === "es" ? <span>🇪🇸</span> : <span>🇺🇸</span>}</div>
              <div style={{ color: job.producer === "Genesis" ? "#22C55E" : "#6366F1", fontWeight: 600, fontSize: "12px" }}>{job.producer}</div>
              <div style={{ color: "#C9973A", fontWeight: 600 }}>{job.credits}</div>
              <div style={{ color: "#6B7280" }}>{job.date}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function VideoProducer({ session, onSettings, onLogout }) {
  const [screen, setScreen] = useState("main");
  const [step, setStep] = useState(1);
  const [customChannels, setCustomChannels] = useState([]);
  const [channel, setChannel] = useState("");
  const [clientName, setClientName] = useState("");
  const [language, setLanguage] = useState("both");
  const [producer, setProducer] = useState("Twila");
  const [script, setScript] = useState("");
  const [spanishScript, setSpanishScript] = useState("");
  const [prompts, setPrompts] = useState(MOCK_PROMPTS);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [images, setImages] = useState([]);
  const [rejectedImages, setRejectedImages] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [imageModel, setImageModel] = useState("nano_banana_2");
  const [videoModel, setVideoModel] = useState("kling3_0_turbo");
  const [qualityTier, setQualityTier] = useState("standard");
  const [showModelBrowser, setShowModelBrowser] = useState(null);
  const [costPreview, setCostPreview] = useState(null);
  const [checkingCost, setCheckingCost] = useState(false);
  const [imageJobIds, setImageJobIds] = useState([]);
  const [imageProgress, setImageProgress] = useState([]);
  const [animationJobIds, setAnimationJobIds] = useState({});
  const [animationProgress, setAnimationProgress] = useState({});
  const [assembling, setAssembling] = useState(false);
  const [assemblyJobId, setAssemblyJobId] = useState(null);
  const [enVideoUrl, setEnVideoUrl] = useState(null);
  const [esVideoUrl, setEsVideoUrl] = useState(null);
  const assemblyPollRef = useRef(null);
  const [animationUrls, setAnimationUrls] = useState({});
  const pollRef = useRef(null);
  const animPollRef = useRef(null);
  // ✅ FIX: refs to avoid stale closures in polling intervals
  const imageJobsRef = useRef([]);
  const imageModelRef = useRef("nano_banana_2");
  const [animatedScenes, setAnimatedScenes] = useState(new Set([0]));
  const [animationTier, setAnimationTier] = useState("minimal");
  const [animating, setAnimating] = useState(false);
  const [animationReady, setAnimationReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [jobs, setJobs] = useState([
    { title: "WOH V39 — Comeback Kids", channel: "A World of Horses", language: "both", producer: "Twila", credits: 19.5, date: "7/3/2026" },
    { title: "WOH V38 — Senior Souls", channel: "A World of Horses", language: "both", producer: "Twila", credits: 19.5, date: "7/3/2026" },
  ]);

  const allChannels = [
    ...(session?.isAdmin ? PRESET_CHANNELS : [{ id: "other", name: "✦ Other / Client Work", style: "", kling_style: "", preset: true, isOther: true }]),
    ...customChannels,
  ];
  const selectedChannel = allChannels.find(c => c.id === channel);
  const isBilingual = language === "both";
  const needsTranslation = language === "both" || language === "es";
  const isSpanishOnly = language === "es";
  const isOther = selectedChannel?.isOther;

  const [savedPreference, setSavedPreference] = useState(false);
  const [preferenceSaved, setPreferenceSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.storage.get("videoforge:modelPreference");
        if (result?.value) {
          const pref = JSON.parse(result.value);
          setImageModel(pref.imageModel);
          setVideoModel(pref.videoModel);
          setQualityTier(pref.qualityTier || "custom");
          setSavedPreference(true);
        }
      } catch (e) {}
    };
    load();
  }, []);

  const handleSavePreference = async () => {
    try {
      await window.storage.set("videoforge:modelPreference", JSON.stringify({
        imageModel, videoModel, qualityTier, savedAt: new Date().toLocaleDateString(),
      }));
      setPreferenceSaved(true);
      setSavedPreference(true);
      setTimeout(() => setPreferenceSaved(false), 2000);
    } catch (e) {
      console.error("Could not save preference", e);
    }
  };

  const handleChannelSelect = (ch) => {
    setChannel(ch.id);
    if (ch.defaultLang) setLanguage(ch.defaultLang);
    if (!ch.isOther) setClientName("");
  };

  const handleProceedToPrompts = () => {
    setGenerating(true);
    const style = selectedChannel?.style || "";
    generatePrompts(script, style, session)
      .then(data => { setPrompts(data.prompts); setGenerating(false); setStep(3); })
      .catch(err => { alert("Prompt generation error: " + err.message); setGenerating(false); });
  };

  const handleGenerateImages = () => {
    // ✅ FIX 1: Capture jobId and imageModel NOW before any async state changes
    const currentJobId = assemblyJobId || `vf-${Date.now()}`;
    if (!assemblyJobId) setAssemblyJobId(currentJobId);
    const currentImageModel = imageModel; // capture current value synchronously
    imageModelRef.current = currentImageModel;

    setGenerating(true);
    setImageProgress(new Array(8).fill("IN_QUEUE"));
    setImages(new Array(8).fill(null));

    // ✅ FIX 2: Use captured model value, not state (which may be stale)
    submitImages(prompts, currentImageModel, session)
      .then(data => {
        const submittedJobs = data.jobs;
        // ✅ FIX 3: Store jobs in ref so polling interval always has fresh value
        imageJobsRef.current = submittedJobs;
        setImageJobIds(submittedJobs);
        setGenerating(false);
        setStep(4);

        pollRef.current = setInterval(async () => {
          try {
            // ✅ FIX 4: Use ref (not stale closure variable) for both jobs and jobId
            const result = await checkJobs(imageJobsRef.current, session, currentJobId);

            // ✅ FIX 5: Use functional state updates to avoid stale image/progress state
            setImages(prev => {
              const newImages = [...prev];
              result.results.forEach(r => {
                if (r.status === "COMPLETED" && r.url) newImages[r.index] = r.url;
              });
              return newImages;
            });
            setImageProgress(prev => {
              const newProgress = [...prev];
              result.results.forEach(r => { newProgress[r.index] = r.status; });
              return newProgress;
            });

            if (result.allDone) {
              clearInterval(pollRef.current);
            }
          } catch (err) {
            console.error("Image polling error:", err.message);
          }
        }, 4000);
      })
      .catch(err => {
        setGenerating(false);
        alert("Image submission error: " + err.message);
      });
  };

  const handleRejectImage = (idx) => {
    setRejectedImages(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  };

  const handleRegenerateRejected = () => {
    setGenerating(true);
    setTimeout(() => { setRejectedImages(new Set()); setGenerating(false); }, 1500);
  };

  const selectedImageModel = ALL_IMAGE_MODELS.find(m => m.id === imageModel);
  const selectedVideoModel = ALL_VIDEO_MODELS.find(m => m.id === videoModel);

  const imageCredits = (selectedImageModel?.credits || 1.5) * 8;
  const animationCredits = animatedScenes.size * (selectedVideoModel?.credits || 7.5);
  const totalCredits = Math.round((imageCredits + animationCredits) * 10) / 10;
  const totalCost = (totalCredits * 0.0625).toFixed(2);

  const handleCheckCost = () => {
    setCheckingCost(true);
    setTimeout(() => {
      setCostPreview({
        imageCredits: imageCredits.toFixed(1),
        animationCredits: animationCredits.toFixed(1),
        total: totalCredits,
        imageModel: selectedImageModel?.name,
        videoModel: selectedVideoModel?.name,
        animationCount: animatedScenes.size,
      });
      setCheckingCost(false);
    }, 800);
  };

  const ANIMATION_TIERS = [
    { id: "minimal", label: "Minimal", desc: "Scene 01 only", scenes: [0] },
    { id: "balanced", label: "Balanced", desc: "Scenes 01, 04 & 08", scenes: [0, 3, 7] },
    { id: "full", label: "Full", desc: "All 8 scenes", scenes: [0,1,2,3,4,5,6,7] },
    { id: "custom", label: "Custom", desc: "Choose below", scenes: null },
  ];

  const handleTierSelect = (tier) => {
    setAnimationTier(tier.id);
    if (tier.scenes) setAnimatedScenes(new Set(tier.scenes));
  };

  const toggleScene = (idx) => {
    setAnimationTier("custom");
    setAnimatedScenes(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  };

  const handleAnimate = () => {
    setAnimating(true);
    const animatedList = [...animatedScenes].sort((a, b) => a - b);
    const motionPrompt = `${selectedChannel?.kling_style || "slow, cinematic"}. Gentle natural movement. Warm atmospheric light.`;
    const currentAssemblyJobId = assemblyJobId; // capture for closure

    submitAnimations(images, animatedList, motionPrompt, videoModel, session)
      .then(data => {
        const animJobs = data.jobs;
        setAnimationJobIds(animJobs);

        const initialProgress = {};
        animatedList.forEach(idx => { initialProgress[idx] = "IN_QUEUE"; });
        setAnimationProgress(initialProgress);

        animPollRef.current = setInterval(async () => {
          try {
            // ✅ FIX: pass captured assemblyJobId for URL logging
            const result = await checkJobs(animJobs, session, currentAssemblyJobId);

            setAnimationUrls(prev => {
              const newUrls = { ...prev };
              result.results.forEach(r => {
                const sceneIdx = r.sceneIndex !== undefined ? r.sceneIndex : r.index;
                if (r.status === "COMPLETED" && r.url) newUrls[sceneIdx] = r.url;
              });
              return newUrls;
            });
            setAnimationProgress(prev => {
              const newProgress = { ...prev };
              result.results.forEach(r => {
                const sceneIdx = r.sceneIndex !== undefined ? r.sceneIndex : r.index;
                newProgress[sceneIdx] = r.status;
              });
              return newProgress;
            });

            if (result.allDone) {
              clearInterval(animPollRef.current);
              setAnimating(false);
              setAnimationReady(true);
              setStep(5);
            }
          } catch (err) {
            clearInterval(animPollRef.current);
            setAnimating(false);
            alert("Animation polling error: " + err.message);
          }
        }, 6000);
      })
      .catch(err => {
        setAnimating(false);
        alert("Animation submission error: " + err.message);
      });
  };

  const handleAssemble = () => {
    setAssembling(true);
    const jobId = assemblyJobId || `vf-${Date.now()}`;
    if (!assemblyJobId) setAssemblyJobId(jobId);

    const jobData = {
      jobId,
      imageUrls: images,
      animationUrls,
      enScript: script,
      esScript: spanishScript,
      language,
      title: videoTitle,
    };

    assembleVideo(jobData, session)
      .then(() => {
        // Background function accepted (202) — start polling every 10 seconds
        assemblyPollRef.current = setInterval(async () => {
          try {
            const status = await checkAssemblyStatus(jobId, session);
            if (status.enUrl) setEnVideoUrl(status.enUrl);
            if (status.esUrl) setEsVideoUrl(status.esUrl);
            if (status.allReady) {
              clearInterval(assemblyPollRef.current);
              assemblyPollRef.current = null;
              setAssembling(false);
            }
          } catch (err) {
            console.error("Assembly poll error:", err.message);
          }
        }, 10000);
      })
      .catch(err => {
        setAssembling(false);
        alert("Assembly error: " + err.message);
      });
  };

  const handleSave = () => {
    setSaving(true);
    const jobData = {
      title: videoTitle,
      channel: selectedChannel?.name || "Unknown",
      client: isOther ? clientName : undefined,
      language, producer, imageModel, videoModel,
      animationCount: animatedScenes.size,
      credits: totalCredits,
      sceneUrls: images,
      klingUrl: animationUrls[0] || null,
      date: new Date().toLocaleDateString("en-US"),
    };
    saveToAirtable(jobData, session)
      .then(() => { setJobs(prev => [{ ...jobData }, ...prev]); setSaving(false); setStep(6); })
      .catch(() => { setJobs(prev => [{ ...jobData }, ...prev]); setSaving(false); setStep(6); });
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (animPollRef.current) clearInterval(animPollRef.current);
    if (assemblyPollRef.current) clearInterval(assemblyPollRef.current);
    imageJobsRef.current = [];
    imageModelRef.current = "nano_banana_2";
    setStep(1); setChannel(""); setClientName(""); setLanguage("both");
    setScript(""); setSpanishScript(""); setPrompts(MOCK_PROMPTS);
    setImages([]); setRejectedImages(new Set()); setAnimationReady(false);
    setVideoTitle(""); setGenerating(false); setTranslating(false);
    setImageModel("nano_banana_2"); setVideoModel("kling3_0_turbo");
    setCostPreview(null); setAnimatedScenes(new Set([0])); setAnimationTier("minimal");
    setQualityTier("standard"); setPreferenceSaved(false);
    setImageJobIds([]); setImageProgress([]); setAnimationJobIds({});
    setAnimationProgress({}); setAnimationUrls({});
    setAssembling(false); setAssemblyJobId(null);
    setEnVideoUrl(null); setEsVideoUrl(null);
  };

  // ── Screens ──────────────────────────────────────────────────────────────

  if (screen === "addChannel") {
    return (
      <div style={{ minHeight: "100vh", background: "#0F1117", color: "#E8E8E8", fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <AppHeader screen="addChannel" jobs={jobs} onNav={setScreen} session={session} onSettings={onSettings} onLogout={onLogout} />
        <div style={{ paddingTop: "24px" }}>
          <AddChannelScreen customChannels={customChannels} onSave={(ch) => { setCustomChannels(prev => [...prev, ch]); setScreen("main"); }} onCancel={() => setScreen("main")} />
        </div>
      </div>
    );
  }

  if (screen === "jobLog") {
    return (
      <div style={{ minHeight: "100vh", background: "#0F1117", color: "#E8E8E8", fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <AppHeader screen="jobLog" jobs={jobs} onNav={setScreen} session={session} onSettings={onSettings} onLogout={onLogout} />
        <div style={{ paddingTop: "24px" }}>
          <JobLogScreen jobs={jobs} onClose={() => setScreen("main")} />
        </div>
      </div>
    );
  }

  // ── Main Pipeline ─────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#0F1117", color: "#E8E8E8", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <AppHeader screen="main" jobs={jobs} onNav={setScreen} step={step} needsTranslation={needsTranslation} session={session} onSettings={onSettings} onLogout={onLogout} />

      <div style={{ padding: "24px 32px 0", maxWidth: "960px", margin: "0 auto" }}>
        {/* Progress bar */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: "32px" }}>
          {STEPS.filter(s => needsTranslation || s.id !== 2).map((s, i, arr) => {
            const isComplete = step > s.id;
            const isActive = step === s.id;
            const num = needsTranslation ? s.id : (s.id > 2 ? s.id - 1 : s.id);
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < arr.length - 1 ? 1 : "none" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div style={{
                    width: "30px", height: "30px", borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "12px", fontWeight: 700, flexShrink: 0,
                    background: isComplete ? "#22C55E" : isActive ? "#C9973A" : "#1A1D27",
                    border: `2px solid ${isActive ? "#C9973A" : isComplete ? "#22C55E" : "#2A2D3A"}`,
                    color: isActive || isComplete ? "#fff" : "#4B5563",
                    boxShadow: isActive ? "0 0 12px rgba(201,151,58,0.4)" : "none",
                    transition: "all 0.3s",
                  }}>
                    {isComplete ? "✓" : num}
                  </div>
                  <div style={{ fontSize: "10px", whiteSpace: "nowrap", textAlign: "center", color: isActive ? "#C9973A" : isComplete ? "#22C55E" : "#4B5563", fontWeight: isActive ? 600 : 400 }}>
                    {s.label}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ flex: 1, height: "2px", background: isComplete ? "#22C55E" : "#2A2D3A", margin: "0 6px", marginBottom: "20px", transition: "background 0.3s" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: Channel & Script ── */}
        {step === 1 && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "6px" }}>Choose your channel & paste your script</div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "28px" }}>The tool handles everything after this — images, animation, translation, and Airtable.</div>

            <div style={{ marginBottom: "20px" }}>
              <Label>Producer</Label>
              <div style={{ display: "flex", gap: "10px" }}>
                {["Twila", "Genesis"].map(p => (
                  <button key={p} onClick={() => setProducer(p)} style={{ ...card(producer === p), padding: "10px 24px", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px" }}>{p === "Twila" ? "👩‍💼" : "👩‍💻"}</span>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: isOther ? "12px" : "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <Label style={{ margin: 0 }}>Channel</Label>
                <button onClick={() => setScreen("addChannel")} style={{ fontSize: "12px", color: "#C9973A", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add Channel</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {allChannels.map(c => (
                  <button key={c.id} onClick={() => handleChannelSelect(c)} style={{ ...card(channel === c.id), display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span>{c.name}</span>
                    {!c.preset && <span style={{ fontSize: "10px", color: "#4B5563", fontWeight: 400 }}>Custom · {c.addedOn}</span>}
                  </button>
                ))}
              </div>
            </div>

            {isOther && (
              <div style={{ marginBottom: "20px" }}>
                <Label>Client Name</Label>
                <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Maria's Bakery, John's Fitness Channel..." style={inputStyle} />
                <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "6px" }}>Logged to Job Log so you can track credits per client.</div>
              </div>
            )}

            <div style={{ marginBottom: "20px" }}>
              <Label>Output Language</Label>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {[
                  { id: "en", label: "🇺🇸 English only" },
                  { id: "both", label: "🇺🇸 + 🇪🇸 Both", badge: "Auto-translated" },
                  { id: "es", label: "🇪🇸 Spanish only", badge: "Auto-translated" },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setLanguage(opt.id)} style={{ ...card(language === opt.id), padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
                    {opt.label}
                    {opt.badge && <span style={{ fontSize: "10px", background: "rgba(201,151,58,0.2)", color: "#C9973A", padding: "2px 6px", borderRadius: "4px", fontWeight: 700 }}>{opt.badge}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <Label style={{ margin: 0 }}>Generation Models</Label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {savedPreference && <span style={{ fontSize: "11px", color: "#22C55E", fontWeight: 600 }}>✓ Saved preference loaded</span>}
                  <button onClick={handleCheckCost} disabled={checkingCost} style={{ fontSize: "12px", color: "#C9973A", background: "rgba(201,151,58,0.1)", border: "1px solid rgba(201,151,58,0.3)", borderRadius: "6px", padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
                    {checkingCost ? "Checking..." : "⚡ Check Credits"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                {QUALITY_TIERS.map(tier => (
                  <button key={tier.id} onClick={() => { setQualityTier(tier.id); setImageModel(tier.imageModel); imageModelRef.current = tier.imageModel; setVideoModel(tier.videoModel); setCostPreview(null); }} style={{
                    flex: 1, padding: "12px 14px", borderRadius: "10px", cursor: "pointer", textAlign: "left",
                    background: qualityTier === tier.id ? "rgba(201,151,58,0.1)" : "#1A1D27",
                    border: qualityTier === tier.id ? "2px solid #C9973A" : "2px solid #2A2D3A",
                  }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: qualityTier === tier.id ? "#C9973A" : "#E8E8E8", marginBottom: "3px" }}>
                      {tier.label}
                      {tier.default && qualityTier !== tier.id && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#4B5563", fontWeight: 400 }}>default</span>}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "6px" }}>{tier.desc}</div>
                    <div style={{ fontSize: "10px", color: "#4B5563" }}>{tier.imageName} + {tier.videoName}</div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, marginTop: "4px" }}>{tier.approxCredits} credits/video</div>
                  </button>
                ))}
              </div>

              <div style={{ background: "#1A1D27", border: "2px solid #2A2D3A", borderRadius: "10px", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>Current selection</div>
                  <div style={{ fontSize: "13px", color: "#E8E8E8" }}>
                    <span style={{ color: "#C9973A", fontWeight: 600 }}>Images:</span> {selectedImageModel?.name || "Nano Banana 2"}
                    <span style={{ color: "#4B5563", margin: "0 8px" }}>·</span>
                    <span style={{ color: "#C9973A", fontWeight: 600 }}>Animation:</span> {selectedVideoModel?.name || "Kling 3.0 Turbo"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setShowModelBrowser("image")} style={{ padding: "6px 12px", borderRadius: "7px", border: "1px solid #3A3D4A", background: "transparent", color: "#9CA3AF", fontSize: "12px", cursor: "pointer" }}>Browse Models</button>
                  <button onClick={handleSavePreference} style={{ padding: "6px 12px", borderRadius: "7px", border: "1px solid rgba(201,151,58,0.4)", background: "rgba(201,151,58,0.08)", color: "#C9973A", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
                    {preferenceSaved ? "✓ Saved!" : "Save as My Default"}
                  </button>
                </div>
              </div>

              {costPreview && (
                <div style={{ marginTop: "12px", background: "rgba(201,151,58,0.06)", border: "1px solid rgba(201,151,58,0.25)", borderRadius: "10px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "12px", color: "#C9973A", fontWeight: 700, marginBottom: "10px" }}>⚡ Estimated Credit Cost</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "3px" }}>8 images ({costPreview.imageModel})</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#E8E8E8" }}>{costPreview.imageCredits}</div>
                      <div style={{ fontSize: "11px", color: "#4B5563" }}>credits</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "3px" }}>{costPreview.animationCount} animation{costPreview.animationCount !== 1 ? "s" : ""} ({costPreview.videoModel})</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#E8E8E8" }}>{costPreview.animationCredits}</div>
                      <div style={{ fontSize: "11px", color: "#4B5563" }}>credits</div>
                    </div>
                    <div style={{ background: "rgba(201,151,58,0.1)", borderRadius: "8px", padding: "10px 12px" }}>
                      <div style={{ fontSize: "11px", color: "#C9973A", marginBottom: "3px", fontWeight: 600 }}>Total</div>
                      <div style={{ fontSize: "22px", fontWeight: 700, color: "#C9973A" }}>{costPreview.total}</div>
                      <div style={{ fontSize: "11px", color: "#6B7280" }}>credits per video</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "11px", color: "#4B5563", marginTop: "10px" }}>* Final total may vary if you change animation scenes in the next step.</div>
                </div>
              )}

              {showModelBrowser && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
                  <div style={{ background: "#1A1D27", borderRadius: "16px", border: "2px solid #2A2D3A", width: "100%", maxWidth: "680px", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ padding: "20px 24px", borderBottom: "1px solid #2A2D3A", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 700 }}>Browse Models</div>
                        <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>In production, these are fetched live from Higgsfield</div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => setShowModelBrowser("image")} style={{ padding: "6px 14px", borderRadius: "7px", border: "none", background: showModelBrowser === "image" ? "#C9973A" : "#2A2D3A", color: showModelBrowser === "image" ? "#0F1117" : "#9CA3AF", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Images</button>
                        <button onClick={() => setShowModelBrowser("video")} style={{ padding: "6px 14px", borderRadius: "7px", border: "none", background: showModelBrowser === "video" ? "#C9973A" : "#2A2D3A", color: showModelBrowser === "video" ? "#0F1117" : "#9CA3AF", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Animation</button>
                        <button onClick={() => setShowModelBrowser(null)} style={{ padding: "6px 10px", borderRadius: "7px", border: "1px solid #3A3D4A", background: "transparent", color: "#9CA3AF", fontSize: "14px", cursor: "pointer" }}>✕</button>
                      </div>
                    </div>
                    <div style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
                      {(showModelBrowser === "image" ? ALL_IMAGE_MODELS : ALL_VIDEO_MODELS).map(m => {
                        const isSelected = showModelBrowser === "image" ? imageModel === m.id : videoModel === m.id;
                        return (
                          <button key={m.id} onClick={() => {
                            if (showModelBrowser === "image") { setImageModel(m.id); setQualityTier("custom"); }
                            else { setVideoModel(m.id); setQualityTier("custom"); }
                            setCostPreview(null);
                            setShowModelBrowser(null);
                          }} style={{ width: "100%", padding: "14px 16px", borderRadius: "10px", marginBottom: "8px", border: isSelected ? "2px solid #C9973A" : "2px solid #2A2D3A", background: isSelected ? "rgba(201,151,58,0.08)" : "#0F1117", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <div style={{ fontSize: "14px", fontWeight: 600, color: isSelected ? "#C9973A" : "#E8E8E8", marginBottom: "4px" }}>
                                {m.name}{isSelected && <span style={{ marginLeft: "8px", fontSize: "11px", color: "#C9973A" }}>← current</span>}
                              </div>
                              <div style={{ fontSize: "12px", color: "#6B7280" }}>{m.desc}</div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "16px" }}>
                              <div style={{ fontSize: "16px", fontWeight: 700, color: "#C9973A" }}>{m.credits}</div>
                              <div style={{ fontSize: "11px", color: "#6B7280" }}>credits/{showModelBrowser === "image" ? "image" : "scene"}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ padding: "16px 24px", borderTop: "1px solid #2A2D3A", fontSize: "12px", color: "#4B5563" }}>
                      Select a model to use it for this video. Use "Save as My Default" on the main screen to remember your choice.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: "20px" }}>
              <Label>Video Title</Label>
              <input value={videoTitle} onChange={e => setVideoTitle(e.target.value)} placeholder="e.g. WOH Video 39 — Comeback Kids" style={inputStyle} />
            </div>

            <div style={{ marginBottom: "28px" }}>
              <Label>Script (English)</Label>
              <textarea value={script} onChange={e => setScript(e.target.value)} placeholder="Paste your finished English script here..." rows={10} style={{ ...inputStyle, resize: "vertical", lineHeight: "1.6" }} />
              <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "6px" }}>
                {script.length > 0 ? `${script.split(/\s+/).filter(Boolean).length} words` :
                  isSpanishOnly ? "Paste English — auto-translated to Spanish only" :
                  isBilingual ? "Paste English — Spanish auto-translated and shown for review" :
                  "Paste your script — Claude writes 8 scene prompts automatically"}
              </div>
            </div>

            <button
              onClick={() => {
                if (needsTranslation) {
                  setTranslating(true);
                  translateScript(script, session)
                    .then(data => { setSpanishScript(data.spanish); setTranslating(false); setStep(2); })
                    .catch(err => { alert("Translation error: " + err.message); setTranslating(false); });
                } else {
                  handleProceedToPrompts();
                }
              }}
              disabled={!channel || !script.trim() || !videoTitle.trim() || (isOther && !clientName.trim()) || translating || generating}
              style={primaryBtn(!channel || !script.trim() || !videoTitle.trim() || (isOther && !clientName.trim()) || translating || generating)}
            >
              {translating ? "Translating to Spanish..." : generating ? "Writing scene prompts..." : needsTranslation ? "Translate & Continue →" : "Generate Scene Prompts →"}
            </button>
          </div>
        )}

        {/* ── STEP 2: Spanish Review ── */}
        {step === 2 && needsTranslation && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "6px" }}>Review Spanish translation</div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "24px" }}>
              {isSpanishOnly ? "Auto-translated to US Hispanic Spanish. No English video will be produced." : "Auto-translated to US Hispanic Spanish. Edit any lines before continuing."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isSpanishOnly ? "1fr" : "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
              {!isSpanishOnly && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <span>🇺🇸</span><Label style={{ margin: 0 }}>English (original)</Label>
                  </div>
                  <div style={{ background: "#1A1D27", border: "2px solid #2A2D3A", borderRadius: "10px", padding: "14px 16px", fontSize: "13px", color: "#6B7280", lineHeight: "1.7", height: "360px", overflowY: "auto", whiteSpace: "pre-wrap" }}>{script}</div>
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <span>🇪🇸</span><Label style={{ margin: 0 }}>Spanish {isSpanishOnly ? "(auto-translated · editable)" : "(editable)"}</Label>
                </div>
                <textarea value={spanishScript} onChange={e => setSpanishScript(e.target.value)} style={{ ...inputStyle, resize: "none", lineHeight: "1.7", height: "360px", fontSize: "13px" }} />
              </div>
            </div>
            <div style={{ background: "rgba(201,151,58,0.06)", border: "1px solid rgba(201,151,58,0.2)", borderRadius: "10px", padding: "12px 16px", marginBottom: "24px", display: "flex", gap: "10px" }}>
              <span style={{ fontSize: "16px" }}>💡</span>
              <div style={{ fontSize: "13px", color: "#9CA3AF", lineHeight: "1.5" }}>US Hispanic Spanish — check idioms, names, and numbers as words (e.g. "two thousand nine" → "dos mil nueve").</div>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => setStep(1)} style={ghostBtn}>← Back</button>
              <button onClick={handleProceedToPrompts} disabled={!spanishScript.trim() || generating} style={primaryBtn(!spanishScript.trim() || generating)}>
                {generating ? "Writing scene prompts..." : "Looks good — Generate Scene Prompts →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Scene Prompts ── */}
        {step === 3 && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "6px" }}>Review your 8 scene prompts</div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "24px" }}>Edit any prompt before generating. Scene 01 becomes the Kling animation.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px" }}>
              {prompts.map((prompt, i) => (
                <div key={i} style={{ background: "#1A1D27", border: i === 0 ? "2px solid rgba(201,151,58,0.4)" : "2px solid #2A2D3A", borderRadius: "10px", padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ display: "flex", gap: "12px", flex: 1 }}>
                      <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: i === 0 ? "rgba(201,151,58,0.2)" : "#2A2D3A", border: i === 0 ? "1px solid #C9973A" : "1px solid #3A3D4A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0, marginTop: "1px", color: i === 0 ? "#C9973A" : "#6B7280" }}>
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      {editingPrompt === i ? (
                        <textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={3} style={{ flex: 1, background: "#0F1117", border: "1px solid #C9973A", borderRadius: "6px", color: "#E8E8E8", fontSize: "13px", padding: "8px", fontFamily: "inherit", resize: "vertical", outline: "none" }} />
                      ) : (
                        <div style={{ fontSize: "13px", color: "#C4C8D4", lineHeight: "1.5", flex: 1 }}>
                          {prompt}
                          {i === 0 && <span style={{ marginLeft: "8px", fontSize: "11px", color: "#C9973A", fontWeight: 600 }}>← Kling animation</span>}
                        </div>
                      )}
                    </div>
                    <button onClick={() => { if (editingPrompt === i) { const n = [...prompts]; n[i] = editValue; setPrompts(n); setEditingPrompt(null); } else { setEditingPrompt(i); setEditValue(prompt); } }} style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #3A3D4A", background: "transparent", color: "#9CA3AF", fontSize: "12px", cursor: "pointer", flexShrink: 0 }}>
                      {editingPrompt === i ? "Save" : "Edit"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button onClick={() => setStep(needsTranslation ? 2 : 1)} style={ghostBtn}>← Back</button>
              <button onClick={handleGenerateImages} disabled={generating} style={primaryBtn(generating)}>
                {generating ? `Generating... ${imageProgress.filter(s => s === "COMPLETED").length}/8 ready` : "Generate All 8 Images →"}
              </button>
              {generating && <div style={{ fontSize: "12px", color: "#6B7280" }}>Images appear one by one as they complete</div>}
            </div>
          </div>
        )}

        {/* ── STEP 4: Approve Images ── */}
        {step === 4 && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "6px" }}>Review your 8 scenes</div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "24px" }}>
              <strong style={{ color: "#E8E8E8" }}>Left-click</strong> any image to mark it for regeneration.
              <strong style={{ color: "#E8E8E8" }}> Tap the ⚡ button</strong> to toggle Kling animation on that scene.
              {rejectedImages.size > 0 && <span style={{ color: "#F59E0B", marginLeft: "8px" }}>{rejectedImages.size} scene{rejectedImages.size > 1 ? "s" : ""} marked for redo.</span>}
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <Label style={{ margin: 0 }}>Animation</Label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "12px", color: "#6B7280" }}>{animatedScenes.size} scene{animatedScenes.size !== 1 ? "s" : ""} · {animationCredits.toFixed(1)} credits</span>
                  <span style={{ fontSize: "12px", color: "#C9973A", fontWeight: 700 }}>Total: {totalCredits} credits</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                {ANIMATION_TIERS.map(tier => {
                  const tierCredits = tier.scenes ? tier.scenes.length * (selectedVideoModel?.credits || 7.5) : null;
                  return (
                    <button key={tier.id} onClick={() => handleTierSelect(tier)} style={{ flex: 1, padding: "10px 12px", borderRadius: "10px", background: animationTier === tier.id ? "rgba(201,151,58,0.12)" : "#1A1D27", border: animationTier === tier.id ? "2px solid #C9973A" : "2px solid #2A2D3A", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: animationTier === tier.id ? "#C9973A" : "#E8E8E8", marginBottom: "2px" }}>{tier.label}</div>
                      <div style={{ fontSize: "11px", color: "#6B7280" }}>{tier.desc}</div>
                      {tierCredits !== null && <div style={{ fontSize: "11px", color: "#4B5563", marginTop: "2px" }}>{tierCredits.toFixed(1)} credits</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
              {Array.from({ length: 8 }).map((_, i) => {
                const isAnimated = animatedScenes.has(i);
                const isRejected = rejectedImages.has(i);
                const hasImage = images[i];
                const sceneStatus = imageProgress[i];
                return (
                  <div key={i} style={{ position: "relative" }}>
                    <div style={{ position: "absolute", top: "8px", left: "8px", zIndex: 2, width: "22px", height: "22px", borderRadius: "50%", background: isAnimated && hasImage ? "rgba(201,151,58,0.95)" : "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: isAnimated && hasImage ? "#0F1117" : "#fff" }}>
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    {isAnimated && hasImage && (
                      <div style={{ position: "absolute", bottom: "36px", left: "8px", zIndex: 2, background: "rgba(201,151,58,0.95)", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontWeight: 700, color: "#0F1117" }}>⚡ KLING</div>
                    )}
                    {hasImage && (
                      <button onClick={(e) => { e.stopPropagation(); toggleScene(i); }} style={{ position: "absolute", bottom: "8px", left: "8px", zIndex: 4, padding: "3px 8px", borderRadius: "5px", border: "none", background: isAnimated ? "rgba(201,151,58,0.9)" : "rgba(0,0,0,0.6)", color: isAnimated ? "#0F1117" : "#9CA3AF", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>
                        {isAnimated ? "⚡ On" : "⚡ Off"}
                      </button>
                    )}
                    {isRejected && hasImage && (
                      <div style={{ position: "absolute", inset: 0, zIndex: 3, background: "rgba(239,68,68,0.5)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", pointerEvents: "none" }}>✗</div>
                    )}
                    {!hasImage && (
                      <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: "10px", border: "2px dashed #2A2D3A", background: "#1A1D27", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                        <div style={{ fontSize: "20px" }}>{sceneStatus === "FAILED" ? "✗" : "⏳"}</div>
                        <div style={{ fontSize: "10px", color: "#4B5563", textAlign: "center" }}>
                          {sceneStatus === "FAILED" ? "Failed" : sceneStatus === "IN_PROGRESS" ? "Generating..." : "In queue..."}
                        </div>
                      </div>
                    )}
                    {hasImage && (
                      <img src={images[i]} alt={`Scene ${i + 1}`} onClick={() => handleRejectImage(i)} style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: "10px", border: isRejected ? "2px solid #EF4444" : isAnimated ? "2px solid #C9973A" : "2px solid #2A2D3A", cursor: "pointer", display: "block" }} />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {rejectedImages.size > 0 && (
                <button onClick={handleRegenerateRejected} disabled={generating} style={{ padding: "14px 20px", borderRadius: "10px", border: "2px solid #F59E0B", background: "transparent", color: "#F59E0B", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                  {generating ? "Regenerating..." : `Redo ${rejectedImages.size} Scene${rejectedImages.size > 1 ? "s" : ""}`}
                </button>
              )}
              <button onClick={handleAnimate} disabled={rejectedImages.size > 0 || animating || animatedScenes.size === 0} style={primaryBtn(rejectedImages.size > 0 || animating || animatedScenes.size === 0)}>
                {animating ? `Animating ${animatedScenes.size} scene${animatedScenes.size > 1 ? "s" : ""}...` : animatedScenes.size === 0 ? "Select at least 1 scene to animate" : `Animate ${animatedScenes.size} Scene${animatedScenes.size > 1 ? "s" : ""} in Kling →`}
              </button>
              {animatedScenes.size === 0 && <div style={{ fontSize: "12px", color: "#6B7280" }}>You can also skip animation entirely — use all still images.</div>}
            </div>
          </div>
        )}

        {/* ── STEP 5: Approve Animation ── */}
        {step === 5 && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "6px" }}>
              Review your {animatedScenes.size === 1 ? "animation" : `${animatedScenes.size} animations`}
            </div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "24px" }}>
              {animatedScenes.size === 1
                ? `Scene ${[...animatedScenes][0] + 1} animated · used in ${isBilingual ? "both EN and ES videos" : isSpanishOnly ? "the ES video" : "your video"}`
                : `Scenes ${[...animatedScenes].sort((a,b)=>a-b).map(i=>i+1).join(", ")} animated · same clips used in all language outputs`}
            </div>

            <div style={{ display: "flex", gap: "12px", marginBottom: "24px", overflowX: "auto", paddingBottom: "4px" }}>
              {[...animatedScenes].sort((a,b)=>a-b).map(i => {
                const videoUrl = animationUrls[i];
                return (
                  <div key={i} style={{ width: "140px", flexShrink: 0, background: "#1A1D27", borderRadius: "10px", border: "2px solid rgba(201,151,58,0.4)", overflow: "hidden" }}>
                    {videoUrl ? (
                      <video src={videoUrl} controls autoPlay loop muted playsInline style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                    ) : (
                      <img src={images[i]} alt={`Scene ${i+1}`} style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                    )}
                    <div style={{ padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: "11px", color: "#C9973A", fontWeight: 600 }}>Scene {String(i+1).padStart(2,"00")}</div>
                      <div style={{ fontSize: "10px", color: "#6B7280" }}>{videoUrl ? "▶ 5s" : "Still"}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "24px", marginBottom: "28px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ background: "#1A1D27", borderRadius: "12px", border: "2px solid #2A2D3A", padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "#9CA3AF", marginBottom: "16px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Ready to save</div>
                  {[
                    { label: "Channel", value: selectedChannel?.name + (isOther && clientName ? ` — ${clientName}` : "") },
                    { label: "Title", value: videoTitle },
                    { label: "Producer", value: producer },
                    { label: "Output", value: isBilingual ? "EN + ES MP4 pair" : isSpanishOnly ? "ES MP4 only" : "EN MP4" },
                    { label: "Images", value: `${selectedImageModel?.name || "Nano Banana 2"} (×8)` },
                    { label: "Animation", value: `${selectedVideoModel?.name || "Kling 3.0 Turbo"} (×${animatedScenes.size})` },
                    { label: "Animations", value: `${animatedScenes.size} scene${animatedScenes.size !== 1 ? "s" : ""} (${animationTier})` },
                    { label: "Credits", value: `~${totalCredits} credits` },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
                      <div style={{ fontSize: "13px", color: "#6B7280", width: "80px", flexShrink: 0 }}>{row.label}</div>
                      <div style={{ fontSize: "13px", color: "#E8E8E8" }}>{row.value}</div>
                    </div>
                  ))}
                </div>
                {needsTranslation && (
                  <div style={{ background: "rgba(201,151,58,0.06)", borderRadius: "10px", border: "1px solid rgba(201,151,58,0.2)", padding: "14px 16px", display: "flex", gap: "10px" }}>
                    <span>{isBilingual ? "🇺🇸🇪🇸" : "🇪🇸"}</span>
                    <div style={{ fontSize: "13px", color: "#9CA3AF", lineHeight: "1.5" }}>
                      {isBilingual ? "Fish Audio generates EN + ES voiceovers during assembly. Same images — two finished videos." : "Fish Audio generates the Spanish voiceover only. One finished ES video."}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => { setStep(4); setAnimationReady(false); }} style={ghostBtn}>← Redo Animation</button>
              <button onClick={handleSave} disabled={saving} style={primaryBtn(saving)}>
                {saving ? "Saving to Airtable..." : "Save to Airtable → Ready to Assemble"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 6: Done ── */}
        {step === 6 && (
          <div style={{ textAlign: "center", padding: "40px 0", animation: "fadeIn 0.3s ease" }}>
            <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "rgba(34,197,94,0.15)", border: "2px solid #22C55E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", margin: "0 auto 20px" }}>✓</div>
            <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "8px" }}>{videoTitle}</div>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "32px" }}>
              Logged by {producer}{isOther && clientName && ` · Client: ${clientName}`}
            </div>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginBottom: "32px" }}>
              {isBilingual ? (<><div style={summaryBadge("#22C55E")}>🇺🇸 English</div><div style={summaryBadge("#22C55E")}>🇪🇸 Spanish</div></>) :
                isSpanishOnly ? <div style={summaryBadge("#22C55E")}>🇪🇸 Spanish</div> :
                <div style={summaryBadge("#22C55E")}>🇺🇸 English</div>}
              <div style={summaryBadge("#6366F1")}>Job Log ✓</div>
            </div>

            <div style={{ background: "#1A1D27", border: "2px solid #2A2D3A", borderRadius: "16px", padding: "28px", maxWidth: "560px", margin: "0 auto 32px" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>
                {assembling ? "⏳ Assembling your video..." : enVideoUrl || esVideoUrl ? "✅ Videos Ready!" : "Ready to Assemble"}
              </div>
              <div style={{ fontSize: "13px", color: "#6B7280", marginBottom: "24px" }}>
                {assembling ? "Fish Audio is generating voiceovers and FFmpeg is stitching everything together. This takes 3-5 minutes."
                  : enVideoUrl || esVideoUrl ? "Your finished videos are ready to download!"
                  : "Click below to generate voiceovers and assemble your finished MP4s."}
              </div>
              {(enVideoUrl || esVideoUrl) && (
                <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "20px" }}>
                  {enVideoUrl && <a href={enVideoUrl} download={`${videoTitle}-EN.mp4`} style={{ padding: "12px 24px", borderRadius: "10px", background: "linear-gradient(135deg, #C9973A, #E8B85A)", color: "#0F1117", fontSize: "14px", fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }}>↓ Download 🇺🇸 EN</a>}
                  {esVideoUrl && <a href={esVideoUrl} download={`${videoTitle}-ES.mp4`} style={{ padding: "12px 24px", borderRadius: "10px", background: "linear-gradient(135deg, #C9973A, #E8B85A)", color: "#0F1117", fontSize: "14px", fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }}>↓ Download 🇪🇸 ES</a>}
                </div>
              )}
              {!enVideoUrl && !esVideoUrl && (
                <button onClick={handleAssemble} disabled={assembling} style={{ ...primaryBtn(assembling), width: "100%", justifyContent: "center", padding: "16px" }}>
                  {assembling ? "Assembling... check back in a few minutes" : `🎬 Assemble ${isBilingual ? "EN + ES Videos" : isSpanishOnly ? "ES Video" : "EN Video"}`}
                </button>
              )}
              {assembling && <div style={{ marginTop: "16px", fontSize: "12px", color: "#4B5563" }}>You can close this tab and come back — your videos will be waiting when you return.</div>}
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button onClick={() => setScreen("jobLog")} style={ghostBtn}>View Job Log</button>
              <button onClick={handleReset} style={primaryBtn(false)}>Start Next Video →</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── App Header ───────────────────────────────────────────────────────────────

function AppHeader({ screen, jobs, onNav, step, needsTranslation, session, onSettings, onLogout }) {
  const totalSteps = needsTranslation ? 6 : 5;
  return (
    <div style={{ borderBottom: "1px solid #1E2130", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg, #C9973A, #E8B85A)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🎬</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "-0.3px" }}>VideoForge</div>
          <div style={{ fontSize: "11px", color: "#6B7280" }}>Script to video in minutes</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button onClick={() => onNav("main")} style={{ padding: "6px 14px", borderRadius: "8px", border: "none", background: screen === "main" ? "rgba(201,151,58,0.15)" : "transparent", color: screen === "main" ? "#C9973A" : "#6B7280", fontSize: "13px", fontWeight: screen === "main" ? 600 : 400, cursor: "pointer" }}>Pipeline</button>
        <button onClick={() => onNav("jobLog")} style={{ padding: "6px 14px", borderRadius: "8px", border: "none", background: screen === "jobLog" ? "rgba(201,151,58,0.15)" : "transparent", color: screen === "jobLog" ? "#C9973A" : "#6B7280", fontSize: "13px", fontWeight: screen === "jobLog" ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
          Job Log
          {jobs.length > 0 && <span style={{ background: "#C9973A", color: "#0F1117", fontSize: "10px", fontWeight: 700, borderRadius: "10px", padding: "1px 6px" }}>{jobs.length}</span>}
        </button>
        <button onClick={() => onNav("addChannel")} style={{ padding: "6px 14px", borderRadius: "8px", border: "none", background: screen === "addChannel" ? "rgba(201,151,58,0.15)" : "transparent", color: screen === "addChannel" ? "#C9973A" : "#6B7280", fontSize: "13px", fontWeight: screen === "addChannel" ? 600 : 400, cursor: "pointer" }}>+ Channel</button>
        <div style={{ width: "1px", height: "20px", background: "#2A2D3A", margin: "0 4px" }} />
        <button onClick={onSettings} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid #2A2D3A", background: "transparent", color: "#9CA3AF", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
          ⚙️ {session?.name || "Settings"}
          {session?.isAdmin && <span style={{ fontSize: "9px", background: "rgba(201,151,58,0.2)", color: "#C9973A", padding: "1px 5px", borderRadius: "4px", fontWeight: 700 }}>ADMIN</span>}
        </button>
        <button onClick={onLogout} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #2A2D3A", background: "transparent", color: "#6B7280", fontSize: "12px", cursor: "pointer" }}>Sign out</button>
        {screen === "main" && step && (
          <div style={{ fontSize: "12px", color: "#4B5563", marginLeft: "4px" }}>
            {step < 7 ? `Step ${step} of ${totalSteps}` : "Complete ✓"}
          </div>
        )}
      </div>
    </div>
  );
}
