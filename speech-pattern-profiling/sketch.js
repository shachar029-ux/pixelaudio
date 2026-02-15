// --- ACTIVE INTERCEPT: v77 (SYSTEM STABILITY FIX) ---
// 1. AUDIO ROUTING FIX: Properly switches between Mic and File without crashing.
// 2. VISUALS: v58 "Cute Cloud" logic + Spec Page 5-6 Reactivity.
// 3. ARCHIVE: Persistent storage (won't delete on refresh).
// 4. REPORT: Metrics aligned with Page 11-12.

let mic, fft, amp, soundFile, fileInput;
let state = 'WAITING_FOR_USER'; // Must click to start audio שמתי context
let gridScale = 10; // Resolution: Switched to 10 for finer detail

// Physics variables
let smoothedX, smoothedY;
let smoothedSize = 6;
let smoothedScatter = 0;
let timeOffset = 0;
let currentMotionState = "NEUTRAL";
let currentSource = "LIVE";
let currentVolume = 0;
let currentPitchFactor = 0;
let expectingFullScreenAfterUpload = false;

// Data Accumulation
let stats = {
    volSum: 0, pitchSum: 0, frameCount: 0,
    volReadings: [], pitchReadings: [],
    silenceFrames: 0,
    pauseCount: 0, inPause: false, // For Pause Frequency
    spectralTiltSum: 0,
    localDevPitch: 0, localDevVol: 0, // For Jitter/Shimmer
    syllableCount: 0, lastVol: 0, // For Speech Rate
    history: [] // Stores the visual timeline for replay
};
let archiveScrollY = 0;
let legendTab = "PARAMETERS";
let processingTimer = 0;

// Archive
let archive = [];
let analysisReport = {
    id: "", timestamp: "", duration: "00:00",
    primaryPattern: "ANALYZING...",
    coreMetrics: { dominance: 0, coherence: 0, stability: 0, fluency: 0 },
    voiceChar: { softness: 0, tension: 0, expressiveness: 0 },
    summaryText: "",
    visualParams: { mode: "NEUTRAL", size: 6, scatter: 0 }
};
let fromArchive = false;
let emailInput, showEmailModal = false;
let reportStartTime = 0;

// FIXED STORAGE KEY - Prevents deletion on refresh
const STORAGE_KEY = 'activeIntercept_PERSISTENT_DB_v1';
const PALETTE = { BG: '#000000', GRID: '#ffffff15', TEXT: '#ffffff' };

function setup() {
    createCanvas(windowWidth, windowHeight);
    noSmooth();
    textFont('Courier New');

    loadArchiveFromLocal();

    smoothedX = width / 2;
    smoothedY = height / 2;

    // INIT AUDIO OBJECTS (Don't start yet)
    mic = new p5.AudioIn();
    amp = new p5.Amplitude();
    fft = new p5.FFT(0.8, 512);

    fileInput = createFileInput(handleFile);
    fileInput.style('display', 'none');

    // Email Modal Input
    emailInput = createInput('');
    emailInput.addClass('intercept-input');
}

function draw() {
    background(PALETTE.BG);

    if (showEmailModal) {
        drawEmailModal();
        return; // Don't run rest of draw
    }

    // --- STATE 1: CLICK TO START (Browser Security Policy) ---
    if (state === 'WAITING_FOR_USER') {
        drawGrid();
        fill(0, 150); rect(0, 0, width, height);
        fill(255); textAlign(CENTER, CENTER); textSize(14);
        text(">> SYSTEM INITIALIZATION REQUIRED", width / 2, height / 2 - 30);

        if (frameCount % 60 < 30) fill(255); else fill(100);
        textSize(20); text("[ CLICK ANYWHERE TO ACTIVATE ]", width / 2, height / 2 + 10);
        return;
    }

    // --- NORMAL OPERATION ---
    if (state !== 'ARCHIVE') drawGrid();

    if (state === 'IDLE') {
        let vol = mic.getLevel();
        // Auto-trigger if sound detected (after user has clicked once)
        if (vol > 0.01) {
            resetStats();
            state = 'PLAYING';
        }
        else { runIdleBehavior(); }
        drawIdleUI();
    }
    else if (state === 'PLAYING') {
        runLiveVisualizer();
        drawPlayingUI();

        // Auto-stop for file
        if (soundFile && !soundFile.isPlaying() && soundFile.duration() > 0) {
            finishAnalysis();
        }
    }
    else if (state === 'PROCESSING') {
        drawProcessingScreen();
        // Transition to report after 3 seconds (180 frames)
        if (frameCount - processingTimer > 180) {
            state = 'REPORT';
            reportStartTime = frameCount;
        }
    }
    else if (state === 'REPORT') {
        drawReportScreen();
        drawReportBlob();
    }
    else if (state === 'ARCHIVE') {
        drawArchiveGrid();
    }
    else if (state === 'LEGEND') {
        drawLegendScreen();
    }
}

function startAudioSystem() {
    console.log(">> Initializing Audio...");
    currentSource = "LIVE"; // Reset to LIVE
    userStartAudio().then(() => {
        mic.start(() => {
            console.log(">> Mic Started!");
            amp.setInput(mic);
            fft.setInput(mic);
            state = 'IDLE';
        }, (err) => {
            console.error(">> Mic Start Error:", err);
            alert("Microphone access denied or error. Please check permissions.");
        });
    });
}

// --- 1. IDLE (Suspension) ---
function runIdleBehavior() {
    // Drifts slowly when no sound is detected
    let driftY = height / 2 + sin(millis() * 0.001) * 20;
    let driftX = width / 2 + cos(millis() * 0.0007) * 20;

    smoothedX = lerp(smoothedX, driftX, 0.02);
    smoothedY = lerp(smoothedY, driftY, 0.02);

    // v58 Visuals - Compact Cloud for entrance
    drawv58Cloud(smoothedX, smoothedY, 5, 0, "DRIFT", false, 0, color(255), frameCount);
}

// --- 2. LIVE VISUALIZER (Reactivity Engine) ---

function runLiveVisualizer() {
    let spectrum = fft.analyze();
    let centroid = fft.getCentroid();
    let rawVol = amp.getLevel();

    // 1. EXTRACT PARAMETERS (Mapping Table)
    let volume = constrain(rawVol * 35, 0, 5.0);
    currentVolume = lerp(currentVolume, volume, 0.2);

    let pitch = map(centroid, 100, 4500, 0, 1, true);
    currentPitchFactor = lerp(currentPitchFactor, pitch, 0.1);

    // Spectral Tilt Proxy
    let lowEnergy = fft.getEnergy(20, 250);
    let highEnergy = fft.getEnergy(2500, 10000);
    let tilt = highEnergy / (lowEnergy + 1);

    // HNR Proxy (Clean vs Noisy)
    let hnr = map(fft.getEnergy(100, 1000), 0, 255, 0, 1, true);

    // --- SCIENTIFIC DATA COLLECTION ---
    let isSilent = volume < 0.05;

    if (isSilent) {
        stats.silenceFrames++;
        if (!stats.inPause) { stats.pauseCount++; stats.inPause = true; }
    } else {
        stats.inPause = false;
        stats.volSum += volume;
        stats.pitchSum += pitch;
        stats.spectralTiltSum += tilt;
        stats.frameCount++;
        stats.volReadings.push(volume);
        stats.pitchReadings.push(pitch);

        // Jitter/Shimmer (Local deviations)
        if (stats.frameCount > 1) {
            stats.localDevPitch += abs(pitch - stats.pitchReadings[stats.pitchReadings.length - 2]);
            stats.localDevVol += abs(volume - stats.volReadings[stats.volReadings.length - 2]);
        }

        // Syllable/Rate Proxy
        if (volume > 0.15 && stats.lastVol <= 0.15) stats.syllableCount++;

        // Auto-stop condition: stop if silence for 6 seconds (360 frames)
        if (stats.silenceFrames > 360 && stats.frameCount > 60) finishAnalysis();
    }
    stats.lastVol = volume;

    // --- 2. DETERMINE MOTION STATE (Visual Feedback) ---
    let targetX = width / 2;
    let targetY = map(currentPitchFactor, 0, 1, height * 0.85, height * 0.15);
    let targetSize = map(volume, 0, 2, 5, 35);
    let targetScatter = 0;

    let localSpeechRate = stats.syllableCount / (stats.frameCount / 60 + 0.1);

    if (isSilent) {
        currentMotionState = "DEFAULT";
        targetY = height * 0.9;
    }
    else if (volume > 1.5 || (localSpeechRate > 1.5 && hnr < 0.4)) {
        currentMotionState = "SCATTERING";
        targetScatter = map(volume, 1.5, 5, 20, 150);
    }
    else if (localSpeechRate > 1.0 && hnr < 0.5) {
        currentMotionState = "VIBRATION";
        targetScatter = 5;
    }
    else if (tilt < 0.3) {
        currentMotionState = "FLOW";
    }
    else if (pitch > 0.6 && tilt > 0.5) {
        currentMotionState = "AGGREGATION";
    }
    else if (pitch < 0.4) {
        currentMotionState = "DRIP";
    }
    else {
        currentMotionState = "DRIFT";
        targetScatter = map(volume, 0, 1.5, 0, 30);
    }

    // Physics
    timeOffset += 0.02;
    let wanderX = map(noise(timeOffset), 0, 1, width * 0.4, width * 0.6);
    if (volume < 0.05) wanderX = width / 2;

    // ... (Existing visual logic)
    smoothedX = lerp(smoothedX, wanderX, 0.08);
    smoothedY = lerp(smoothedY, targetY, 0.08);
    smoothedSize = lerp(smoothedSize, targetSize, 0.1);
    smoothedScatter = lerp(smoothedScatter, targetScatter, 0.1);

    if (frameCount % 3 === 0) {
        stats.history.push({ sz: floor(smoothedSize), sc: floor(smoothedScatter), mo: currentMotionState, py: floor(smoothedY) });
    }

    drawv58Cloud(smoothedX, smoothedY, smoothedSize, smoothedScatter, currentMotionState, false, 0, color(255), frameCount);
}

// --- 3. GRAPHIC ENGINE (Lab-Spec Pixel Cloud) ---

function drawv58Cloud(cx, cy, size, scatter, mode, useSeed, seedIndex, col, timeRef) {
    noStroke();
    let gridCX = floor(cx / gridScale) * gridScale;
    let gridCY = floor(cy / gridScale) * gridScale;

    let particleCount = 100 + (size * 18); // More particles for better 'cloud'
    if (mode === "SCATTERING") particleCount = 350;

    if (useSeed) randomSeed(seedIndex);
    let t = timeRef || frameCount;

    // Visibility: Base visibility even when quiet
    let alphaVal = map(currentVolume, 0, 0.2, 180, 255, true);

    for (let i = 0; i < particleCount; i++) {
        let rX = 0, rY = 0;
        let skipPixel = false;

        if (mode === "DEFAULT") {
            // Small compact group
            rX = randomGaussian(0, size * 0.4);
            rY = randomGaussian(0, size * 0.4);
        }
        else if (mode === "DRIFT") {
            rX = randomGaussian(0, size * 0.8 + (scatter * 0.3));
            rY = randomGaussian(0, size * 0.8 + (scatter * 0.3));
            if (!useSeed) {
                rX += sin(t * 0.04 + i) * 1.5;
                rY += cos(t * 0.04 + i) * 1.5;
            }
        }
        else if (mode === "VIBRATION") {
            rX = randomGaussian(0, size * 0.8);
            rY = randomGaussian(0, size * 0.8);
            rX += random(-scatter, scatter);
            rY += random(-scatter, scatter);
        }
        else if (mode === "FLOW") {
            rX = randomGaussian(0, size * 0.6);
            let flowSpeed = 2;
            let flow = (t * flowSpeed + i * 10) % 300;
            rY = -flow + 150;
            rX += sin(t * 0.02 + i) * 10; // Slight wave
        }
        else if (mode === "AGGREGATION") {
            // Drifting towards center
            let d = map(sin(t * 0.05 + i), -1, 1, 0.5, 1.2);
            rX = randomGaussian(0, size * d);
            rY = randomGaussian(0, size * d);
        }
        else if (mode === "DRIP") {
            rX = randomGaussian(0, size * 1.2);
            let dropSpeed = 3;
            let drop = (t * dropSpeed + i * 20) % 250;
            rY = drop - 50;
            if (drop > 200) skipPixel = true; // Fade out
        }
        else if (mode === "SCATTERING") {
            let angle = random(TWO_PI);
            let radius = random(size, size * 5 + scatter);
            rX = cos(angle) * radius;
            rY = sin(angle) * radius;
        }

        if (skipPixel) continue;

        let x = gridCX + (floor(rX) * gridScale);
        let y = gridCY + (floor(rY) * gridScale);
        // Final snapping to grid
        x = floor(x / gridScale) * gridScale;
        y = floor(y / gridScale) * gridScale;

        // Apply Color (Always White)
        fill(255, alphaVal);

        rect(x, y, gridScale, gridScale);
    }

    if (useSeed) randomSeed(millis());
}


// --- 4. REPORT LOGIC (Page 11-12) ---

// --- 4. REPORT LOGIC (Refined per Spec) ---

function finishAnalysis() {
    let count = stats.frameCount > 0 ? stats.frameCount : 1;
    let totalTimeSec = count / 60;

    // --- 1. BASE PARAMETER CALCULATION (Normalized 0-1) ---
    let p_loudness = constrain(stats.volSum / count, 0, 1);
    let p_loudnessVar = constrain(getStdDev(stats.volReadings) * 5, 0, 1);
    let p_pitch = constrain(stats.pitchSum / count, 0, 1);
    let p_pitchRange = constrain(getStdDev(stats.pitchReadings) * 6, 0, 1);
    let p_speechRate = constrain(totalTimeSec > 0 ? (stats.syllableCount / totalTimeSec) / 4 : 0, 0, 1);
    let p_pauseFreq = constrain(totalTimeSec > 0 ? (stats.pauseCount / totalTimeSec) / 1.5 : 0, 0, 1);
    let p_pauseDur = constrain(stats.pauseCount > 0 ? (stats.silenceFrames / stats.pauseCount) / 45 : 0, 0, 1);
    let p_hnr = constrain(1 - (stats.spectralTiltSum / count), 0, 1);
    let p_tilt = constrain(stats.spectralTiltSum / count, 0, 1);
    let p_jitter = constrain((stats.localDevPitch / count) * 8, 0, 1);
    let p_shimmer = constrain((stats.localDevVol / count) * 8, 0, 1);

    // --- 2. TEMPORAL TRENDS ---
    let split = floor(stats.volReadings.length / 2);
    let firstHalfVol = stats.volReadings.slice(0, split).reduce((a, b) => a + b, 0) / (split || 1);
    let secondHalfVol = stats.volReadings.slice(split).reduce((a, b) => a + b, 0) / (split || 1);
    let t_loudnessTrend = secondHalfVol - firstHalfVol;
    let t_escalation = t_loudnessTrend * 2;

    // --- 3. WEIGHTED DIMENSION CALCULATIONS ---
    let d_dominance = (p_loudness * 0.35) + ((1 - p_pauseFreq) * 0.25) + ((1 - p_pauseDur) * 0.15) + ((1 - p_pitch) * 0.15) + (p_hnr * 0.10);
    let d_coherence = (p_hnr * 0.35) + ((1 - p_jitter) * 0.20) + ((1 - p_shimmer) * 0.20) + ((1 - p_pauseDur) * 0.15) + ((1 - p_loudnessVar) * 0.10);
    let d_stability = ((1 - p_pitchRange) * 0.30) + ((1 - p_loudnessVar) * 0.25) + ((1 - p_jitter) * 0.15) + ((1 - p_shimmer) * 0.15) + ((1 - p_pauseFreq) * 0.15);
    let d_fluency = ((1 - p_pauseFreq) * 0.40) + ((1 - p_pauseDur) * 0.30) + (p_speechRate * 0.30);

    // Derived
    let d_hesitation = ((p_pauseDur * 1.5) + (p_pauseFreq * 1.2) + (1 - d_fluency)) / 3;
    let d_presence = (p_loudness * 0.4 + p_hnr * 0.4 + d_coherence * 0.2);
    let d_effort = (p_tilt * 0.4 + p_shimmer * 0.3 + p_jitter * 0.3);
    let d_masculine = map(p_pitch, 0.5, 0.1, 0, 1, true);
    let d_feminine = map(p_pitch, 0.5, 0.9, 0, 1, true);

    // Affective
    let d_aggression = (p_loudness * 0.30) + (p_tilt * 0.25) + (p_speechRate * 0.20) + ((1 - p_pauseFreq) * 0.15) + (p_shimmer * 0.10);
    let d_arousal = (p_loudness * 0.30) + (p_pitch * 0.25) + (p_speechRate * 0.20) + (p_pitchRange * 0.15) + (p_loudnessVar * 0.10);

    // Derived dimensions for identification
    let d_softness = ((1 - p_loudness) * 0.30) + ((1 - p_tilt) * 0.30) + ((1 - p_pitch) * 0.15) + (p_hnr * 0.15) + ((1 - p_jitter) * 0.10);
    let d_tension = (p_tilt * 0.30) + (p_jitter * 0.25) + (p_shimmer * 0.25) + (p_speechRate * 0.20);

    // --- 4. PATTERN IDENTIFICATION ---
    let dimensions = [
        { name: "Emotionally Activated / Expressive", val: d_arousal },
        { name: "Dominant / Assertive", val: d_dominance },
        { name: "Stable / Calm", val: d_stability },
        { name: "Soft / Intimate", val: d_softness },
        { name: "Tense / Strained", val: d_tension }
    ];
    dimensions.sort((a, b) => b.val - a.val);
    let primary = dimensions[0];

    // Generate ID
    let prefix = (currentSource === "FILE") ? "vr_" : "lvi_";
    let existingItems = archive.filter(a => a.id && a.id.startsWith(prefix));
    let newId = prefix + nf(existingItems.length, 2);

    analysisReport = {
        id: newId,
        type: (currentSource === "FILE") ? "VOICE RECORD" : "LIVE INTERSECTION",
        timestamp: day() + "/" + month() + "/" + year(),
        duration: floor(totalTimeSec),
        primaryPattern: primary.name,
        raw: {
            loudness: p_loudness, loudnessVar: p_loudnessVar,
            pitch: p_pitch, pitchRange: p_pitchRange,
            speechRate: p_speechRate, pauseFreq: p_pauseFreq, pauseDur: p_pauseDur,
            hnr: p_hnr, tilt: p_tilt, jitter: p_jitter, shimmer: p_shimmer
        },
        temporal: { change: (p_loudnessVar + p_pitchRange) / 2, loudnessTrend: t_loudnessTrend, escalation: t_escalation },
        core: { dominance: d_dominance, coherence: d_coherence, stability: d_stability, fluency: d_fluency },
        voiceChar: { softness: 1 - p_loudness, tension: d_effort, hesitation: d_hesitation, expressiveness: p_loudnessVar, presence: d_presence, effort: d_effort },
        affective: { arousal: d_arousal, aggression: d_aggression, male: d_masculine, female: d_feminine },
        nonSpeech: constrain(p_shimmer * 0.3, 0, 1),
        history: stats.history,
        visualParams: { mode: currentMotionState, size: smoothedSize, scatter: smoothedScatter }
    };
    fromArchive = false;
    state = 'PROCESSING';
    processingTimer = frameCount;
}

function getStdDev(arr) {
    if (!arr || arr.length === 0) return 0;
    let mean = arr.reduce((a, b) => a + b) / arr.length;
    let variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// --- 5. UI ---

// --- 5. UI (REDESIGN PER SPEC 1770044747600.png) ---

function drawReportBlob() {
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(width / 2 + 50, 50, width / 2 - 100, height * 0.6);
    drawingContext.clip();

    push();
    translate(width * 0.75, height * 0.28);

    fill(255, 100); textAlign(CENTER); textSize(9);
    text("[ PIXEL STRUCTURE — FINAL STATE ]", 0, -180);
    textSize(7); fill(100);
    text("Timepoint: End of interaction", 0, -165);

    let d_size = 6, d_scatter = 0, d_mode = "DRIFT", d_y = 0;
    if (analysisReport.history && analysisReport.history.length > 0) {
        let speed = 0.3;
        let index = floor((frameCount * speed) % analysisReport.history.length);
        let record = analysisReport.history[index];
        d_size = record.sz || 6;
        d_scatter = record.sc || 0;
        d_mode = record.mo || "DRIFT";
        d_y = map(record.py || height / 2, 0, height, -80, 80);
    } else {
        let v = analysisReport.visualParams || { mode: "NEUTRAL", size: 6, scatter: 0 };
        d_size = v.size; d_scatter = v.scatter; d_mode = v.mode;
    }
    drawv58Cloud(0, d_y, d_size, d_scatter * 0.6, d_mode, false, 0, color(255), frameCount);
    pop();
    drawingContext.restore();
}

function drawReportScreen() {
    let r = analysisReport;
    if (!r) return;

    // Safety Fallbacks
    r.raw = r.raw || {};
    r.temporal = r.temporal || {};
    r.core = r.core || {};
    r.voiceChar = r.voiceChar || {};
    r.affective = r.affective || {};

    let elapsed = frameCount - reportStartTime;
    let lineDelay = 5;
    let charSpeed = 4; // Faster typing for better feel
    let currentLine = 0;

    let typeLine = (txt, tx, ty, col, size = 9, isHeader = false) => {
        let lineStartFrame = currentLine * lineDelay;
        if (elapsed < lineStartFrame) { currentLine++; return; }
        let charsToShow = floor((elapsed - lineStartFrame) * charSpeed);
        let displayTxt = (txt || "").substring(0, charsToShow);

        fill(col); textAlign(LEFT, TOP); textSize(size);
        if (isHeader) textFont('Courier New Bold'); else textFont('Courier New');
        text(displayTxt, tx, ty);

        if (charsToShow < (txt || "").length || (charsToShow >= (txt || "").length && elapsed < (currentLine + 1) * lineDelay + 20 && elapsed % 20 < 10)) {
            let tw = textWidth(displayTxt);
            rect(tx + tw + 2, ty, 6, size);
        }
        currentLine++;
    };

    // --- ENHANCED DIVIDER ---
    stroke(255, 60); line(width / 2, 100, width / 2, height - 120); noStroke();

    // --- PAGE HEADER ---
    let headerX = width * 0.12;
    let headerY = 270;
    let lh = 14;

    typeLine("SPEECH PATTERN PROFILING", headerX, headerY, 255, 11, true);
    typeLine("System: Speech Pattern Interpreter v1.0", headerX, headerY + lh * 1.5, 150);
    typeLine("Session ID: " + (r.id || "N/A"), headerX, headerY + lh * 2.5, 150);
    typeLine("Input Source: " + (r.type || "LIVE"), headerX, headerY + lh * 3.5, 150);
    typeLine("Duration: 00:" + nf(r.duration || 0, 2), headerX, headerY + lh * 4.5, 150);
    typeLine("Status: COMPLETE", headerX, headerY + lh * 5.5, 150);

    // --- BOX 1: TECHNICAL TELEMETRY (Lower Left) ---
    let box1X = width * 0.12;
    let box1Y = 430;
    let col1 = box1X;
    let col2 = box1X + 210;

    let y = box1Y;
    typeLine("INPUT SIGNAL (RAW)", col1, y, 255, 10, true); y += lh * 1.5;
    let param = (label, val, py, px = col1) => { typeLine(label + " ... " + nf(val || 0, 1, 2), px, py, 180); };
    param("Loudness", r.raw.loudness, y); y += lh;
    param("Loudness Var", r.raw.loudnessVar, y); y += lh;
    param("Pitch Mean", r.raw.pitch, y); y += lh;
    param("Pitch Range", r.raw.pitchRange, y); y += lh;
    param("Speech Rate", r.raw.speechRate, y); y += lh;
    param("Pause Freq", r.raw.pauseFreq, y); y += lh;
    param("Pause Dur", r.raw.pauseDur, y); y += lh;
    param("HNR / Tilt", r.raw.hnr, y); y += lh;
    param("Jitter", r.raw.jitter, y); y += lh;
    param("Shimmer", r.raw.shimmer, y); y += lh * 2.5;

    typeLine("TEMPORAL STATE", col1, y, 255, 10, true); y += lh * 1.5;
    param("Temporal Change", r.temporal.change, y); y += lh;
    let trend = (label, val, py, px = col1) => {
        let sign = val >= 0 ? "+" : "";
        typeLine(label + " ... " + sign + nf(val || 0, 1, 2), px, py, 180);
    };
    trend("Loudness Trend", r.temporal.loudnessTrend, y); y += lh;
    trend("Escalation", r.temporal.escalation, y); y += lh * 3;

    // Aligned sub-column inside Box 1
    y = box1Y;
    typeLine("[ BEHAVIORAL METRICS ]", col2, y, 255, 10, true); y += lh * 1.5;
    typeLine("[ CORE ]", col2, y, 150); y += lh;
    let metric = (label, val, py, px = col2) => { typeLine(label + " ... " + nf(val || 0, 1, 2), px, py, 180); };
    metric("Dominance", r.core.dominance, y); y += lh;
    metric("Coherence", r.core.coherence, y); y += lh;
    metric("Stability", r.core.stability, y); y += lh;
    metric("Fluency", r.core.fluency, y); y += lh * 1.5;

    typeLine("[ CHARACTER ]", col2, y, 150); y += lh;
    let pct = (label, val, py, px = col2) => { typeLine(label + " ... " + floor((val || 0) * 100) + "%", px, py, 180); };
    pct("Softness", r.voiceChar.softness, y); y += lh;
    pct("Tension", r.voiceChar.tension, y); y += lh;
    pct("Presence", r.voiceChar.presence, y); y += lh;
    pct("Expressive", r.voiceChar.expressiveness, y); y += lh * 1.5;

    typeLine("[ AFFECTIVE ]", col2, y, 150); y += lh;
    pct("Arousal", r.affective.arousal, y); y += lh;
    pct("Aggression", r.affective.aggression, y); y += lh;
    pct("Female-Coded", r.affective.female, y); y += lh;
    pct("Male-Coded", r.affective.male, y); y += lh * 3;

    // --- BOX 2: SYSTEM SUMMARY (Lower Right) ---
    let colRight = width * 0.58;
    y = height * 0.68;

    typeLine("SYSTEM SUMMARY", colRight, y, 255, 10, true); y += lh * 1.5;
    let primaryName = (r.primaryPattern || "ANALYSIS COMPLETE").toLowerCase();
    typeLine("The interaction presents a " + primaryName + " profile.", colRight, y, 150); y += lh * 2.5;

    typeLine("INTERACTION PROFILE", colRight, y, 255, 10, true); y += lh * 1.5;
    typeLine("PRIMARY PATTERN:", colRight, y, 150); y += lh;
    typeLine(r.primaryPattern || "N/A", colRight, y, 255, 11, true); y += lh * 2.5;

    typeLine("SCAN ARCHIVED // NO ACTION REQUIRED", colRight, y, 100);

    if (elapsed > currentLine * lineDelay) {
        let bY = height - 70;
        drawButton(fromArchive ? "BACK TO ARCHIVE" : "SAVE TO ARCHIVE", width - 360, bY);
        drawButton("EMAIL FEEDBACK", width - 150, bY);
    }
}

function drawThinBar(x, y, label, val) {
    fill(180); text(label, x, y);
    fill(40); rect(x + 150, y - 8, 100, 4);
    fill(255); rect(x + 150, y - 8, map(val, 0, 100, 0, 100), 4);
    text(val + "%", x + 265, y);
}

function drawClassificationBoxes(x, y) {
    let labels = ["ANGER", "JOY", "SADNESS", "CALM", "ANXIETY"];
    let boxSize = 40;
    let gutter = 15;
    let activeLabel = "CALM";
    if (analysisReport.visualParams.mode === "SCATTERING") activeLabel = "ANGER";
    if (analysisReport.visualParams.mode === "DRIP") activeLabel = "SADNESS";
    if (analysisReport.visualParams.mode === "SHARP") activeLabel = "ANXIETY";
    if (analysisReport.visualParams.mode === "DRIFT" && analysisReport.coreMetrics.dominance > 50) activeLabel = "JOY";

    for (let i = 0; i < labels.length; i++) {
        let bx = x + (i * (boxSize + gutter));
        stroke(255, 50); noFill();
        if (labels[i] === activeLabel) { fill(255); noStroke(); }
        rect(bx, y, boxSize, boxSize);
        noStroke(); fill(150); textAlign(CENTER); textSize(8);
        text(labels[i], bx + boxSize / 2, y + boxSize + 15);
    }
}

function drawBar(x, y, label, val) {
    fill(150); noStroke(); textSize(10); textAlign(LEFT, CENTER);
    text(label, x, y + 5);
    fill(50); rect(x + 120, y, 150, 10);
    fill(255); rect(x + 120, y, map(val, 0, 100, 0, 150), 10);
    text(val + "%", x + 280, y + 5);
}

function drawArchiveGrid() {
    stroke(PALETTE.GRID); strokeWeight(1);
    for (let x = 0; x < width; x += gridScale)line(x, 0, x, height);
    for (let y = 0; y < height; y += gridScale)line(0, y, width, y);

    fill(255); textAlign(LEFT, TOP); textSize(14); text("SPEECH PATTERN PROFILING // ARCHIVE", 50, 40);
    textAlign(RIGHT, TOP); textSize(12); fill(150);
    text("[ FULLSCREEN ]", width - 250, 40);
    text("Database / Grid View", width - 50, 40);

    let cols = 5; let marginX = 60; let marginY = 120; let gutter = 60;
    let cardSize = (width - (marginX * 2) - (gutter * (cols - 1))) / cols;

    push();
    // Clip the archive area to avoid overlapping headers/footers
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(0, 100, width, height - 200);
    drawingContext.clip();

    for (let i = 0; i < archive.length; i++) {
        let realIndex = archive.length - 1 - i;
        let item = archive[realIndex];
        let col = i % cols; let row = floor(i / cols);
        let x = marginX + (col * (cardSize + gutter));
        let y = marginY + (row * (cardSize + gutter)) + archiveScrollY;

        // Only draw if visible (Optimization)
        if (y + cardSize > 0 && y < height) {
            drawArchiveCard(x, y, cardSize, item, realIndex);
        }
    }
    drawingContext.restore();
    pop();

    // Bottom Bar Background
    fill(0); noStroke(); rect(0, height - 80, width, 80);
    drawButton("<< BACK TO LIVE", width - 150, height - 50);
}

function drawArchiveCard(x, y, size, item, realIndex) {
    // Delicate but prominent stroke
    noFill(); stroke(255, 120); strokeWeight(1.5); rect(x, y, size, size); noStroke();

    drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(x, y, size, size); drawingContext.clip();
    push(); translate(x + size / 2, y + size / 2); let scaleFactor = 0.25; scale(scaleFactor);

    // --- AUTHENTIC REPLAY ENGINE ---
    let d_size = 6, d_scatter = 0, d_mode = "DRIFT", d_y = 0;

    if (item.history && item.history.length > 0) {
        let speed = 0.3;
        let index = floor((frameCount * speed) % item.history.length);
        let record = item.history[index];
        d_size = record.sz || 6;
        d_scatter = record.sc || 0;
        d_mode = record.mo || "DRIFT";
        d_y = map(record.py || height / 2, 0, height, -150, 150);
    } else {
        let v = item.visualParams || { mode: "NEUTRAL", size: 6, scatter: 0 };
        d_size = v.size; d_scatter = v.scatter; d_mode = v.mode;
    }

    drawv58Cloud(0, d_y, d_size, d_scatter, d_mode, false, realIndex, color(255), frameCount + (realIndex * 100));
    pop(); drawingContext.restore();

    // Labels BELOW the card (Left Aligned - Code Style)
    fill(255); textAlign(LEFT, TOP); textSize(9);
    text(item.id, x, y + size + 8);
    fill(130); textSize(7);
    text(item.primaryPattern, x, y + size + 19);

    let btnS = 18; let btnX = x + size - btnS - 5; let btnY = y + 5;
    if (mouseX > btnX && mouseX < btnX + btnS && mouseY > btnY && mouseY < btnY + btnS) { fill(255, 0, 0); cursor(HAND); } else { fill(80); textAlign(CENTER, CENTER); }
    text("X", btnX + btnS / 2, btnY + btnS / 2 + 5);
}


function drawLegendScreen() {
    background(0);
    drawGrid();

    // --- TAB NAVIGATION ---
    fill(255); textAlign(LEFT, TOP); textSize(16); text("SYSTEM // VISUAL LEXICON", 50, 40);

    let tabX1 = 50; let tabX2 = 300; let tabY = 85;
    textAlign(LEFT, CENTER); textSize(16);

    // Tab 1: Parameters
    fill(legendTab === "PARAMETERS" ? 255 : 80);
    text("[ 01. SIGNAL PARAMETERS ]", tabX1, tabY);
    if (legendTab === "PARAMETERS") { stroke(255); line(tabX1, tabY + 12, tabX1 + 160, tabY + 12); noStroke(); }

    // Tab 2: Formulas
    fill(legendTab === "FORMULAS" ? 255 : 80);
    text("[ 02. ANALYSIS FORMULAS ]", tabX2, tabY);
    if (legendTab === "FORMULAS") { stroke(255); line(tabX2, tabY + 12, tabX2 + 160, tabY + 12); noStroke(); }

    if (legendTab === "PARAMETERS") {
        drawLogicView();
    } else {
        drawFormulasView();
    }

    drawButton("<< BACK TO LIVE", width - 150, height - 50);
}

function drawFormulasView() {
    textSize(14); fill(150); text("DIMENSION MAPPING: COMPUTERIZED CALCULATION FORMULAS", 50, 115);

    let x = 60; let y = 180;
    let colW = 400; let gutter = 60;

    // Row 1: Core
    drawFormulaBox("CORE: DOMINANCE", ["Loudness (Mean) ....... +35%", "Pause Freq (Mean) ..... -25%", "Pause Dur (Mean) ...... -15%", "Pitch (Mean) .......... -15%", "HNR ................... +10%"], x, y, colW);
    drawFormulaBox("CORE: COHERENCE", ["HNR ................... +35%", "Jitter ................ -20%", "Shimmer ............... -20%", "Pause Dur ............. -15%", "Loudness Var .......... -10%"], x + colW + gutter, y, colW);
    drawFormulaBox("CORE: STABILITY", ["Pitch Range ........... -30%", "Loudness Var .......... -25%", "Jitter ................ -15%", "Shimmer ............... -15%", "Pause Freq ............ -15%"], x + (colW + gutter) * 2, y, colW);

    y += 180;
    // Row 2: Character
    drawFormulaBox("CHARACTER: SOFTNESS", ["Loudness (Mean) ....... -30%", "Spectral Tilt ......... -30%", "Pitch (Mean) .......... -15%", "HNR ................... +15%"], x, y, colW);
    drawFormulaBox("CHARACTER: TENSION", ["Spectral Tilt ......... +30%", "Jitter ................ +25%", "Shimmer ............... +25%", "Speech Rate ........... +20%"], x + colW + gutter, y, colW);
    drawFormulaBox("INTERACTION: FLUENCY", ["Pause Freq ............ -40%", "Pause Dur ............. -30%", "Speech Rate ........... +30%"], x + (colW + gutter) * 2, y, colW);
}

function drawFormulaBox(title, lines, x, y, w) {
    fill(255); textSize(16); textFont('Courier New Bold');
    text(title, x, y);
    stroke(255, 60); line(x, y + 12, x + w, y + 12); noStroke();

    y += 40;
    textFont('Courier New'); textSize(14);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('+')) fill(200); else fill(255, 180, 180);
        text(lines[i], x, y + i * 22);
    }
}

function drawLogicView() {
    let x = 60; let y = 140;

    // Grid Lines for the table aesthetic (matches reference image)
    stroke(255, 12);
    for (let gx = x; gx <= width - x; gx += 40) line(gx, y + 60, gx, height - 150);
    for (let gy = y + 60; gy <= height - 150; gy += 30) line(x, gy, width - x, gy);
    noStroke();

    // --- MAIN HEADER ---
    textAlign(CENTER, TOP); noStroke(); fill(255); textSize(13); textFont('Courier New Bold');
    text("GENERATIVE PARAMETERS  |  MIN vs. MAX", width / 2, y);
    stroke(255, 60); line(x, y + 25, width - x, y + 25); noStroke();

    y += 50;

    // --- COLUMN HEADERS ---
    let colL = x + 10;
    let colMid = width / 2;
    let colMinX = colMid - 280;
    let colMaxX = colMid + 120;
    let colR = width - x - 50;

    textAlign(CENTER, TOP); fill(255); textSize(16);
    text("MIN", colMinX + 50, y);
    text("MAX", colMaxX + 50, y);
    stroke(255, 80); line(colMid, y, colMid, height - 120); noStroke();

    y += 40;
    let lh = 45; // Taller rows for bigger text

    let params = [
        "LOUDNESS (MEAN)", "LOUDNESS VARIABILITY", "PITCH (MEAN)", "PITCH (RANGE)",
        "SPEECH RATE", "PAUSE FREQUENCY", "PAUSE DURATION", "HNR"
    ];

    for (let i = 0; i < params.length; i++) {
        // Label
        textAlign(LEFT, CENTER); fill(255); textSize(14); textFont('Courier New Bold');
        text(params[i], colL, y + lh / 2);

        // MIN Visualization
        drawPixelHistogram(colMinX, y + 2, 120, lh - 4, 0.15 + (i * 0.04) % 0.2);

        // MAX Visualization
        drawPixelHistogram(colMaxX, y + 2, 120, lh - 4, 0.6 + (i * 0.06) % 0.3);

        // Right Label
        textAlign(RIGHT, CENTER); fill(150); textSize(12);
        text(i === params.length - 1 ? "HIGH" : "MAX", colR, y + lh / 2);

        y += lh;
    }
}

function drawPixelHistogram(x, y, w, h, intensity) {
    push();
    translate(x, y);
    let rows = 4; let cols = 20;
    let stepX = w / cols; let stepY = h / rows;

    noStroke();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            // Noise based distribution for "organic" pixel histogram look
            let n = noise(c * 0.5, r * 0.5, frameCount * 0.01 + x);
            if (n < intensity) {
                fill(255, map(n, 0, intensity, 50, 200));
                let sz = map(intensity, 0, 1, 2, 5);
                rect(c * stepX, r * stepY + (rows - r) * 2, sz, sz);
            }
        }
    }
    pop();
}


// --- INTERACTION ---

function mousePressed() {
    if (showEmailModal) {
        handleEmailModalClick();
        return;
    }

    if (state === 'WAITING_FOR_USER') {
        startAudioSystem();
        return;
    }

    if (state === 'IDLE') {
        let isTopBar = mouseY < 80;
        // [ ARCHIVE ]
        if (isTopBar && mouseX > width - 140) {
            state = 'ARCHIVE';
            archiveScrollY = 0;
        }
        // [ LEGEND ]
        else if (isTopBar && mouseX > width - 250 && mouseX < width - 150) {
            state = 'LEGEND';
        }
        // [ FULLSCREEN ]
        else if (isTopBar && mouseX > width - 400 && mouseX < width - 260) {
            toggleFullScreen();
        }
        if (abs(mouseX - 150) < 100 && abs(mouseY - (height - 80)) < 20) {
            expectingFullScreenAfterUpload = fullscreen();
            fileInput.elt.click();
        }
        if (mouseY > 150 && mouseX < width - 150) { resetStats(); state = 'PLAYING'; }
    }
    else if (state === 'LEGEND') {
        // Tab 1: Parameters
        if (mouseX > 50 && mouseX < 210 && mouseY > 70 && mouseY < 110) legendTab = "PARAMETERS";
        // Tab 2: Formulas
        if (mouseX > 230 && mouseX < 390 && mouseY > 70 && mouseY < 110) legendTab = "FORMULAS";

        if (mouseY > height - 100 && mouseX > width - 250) resetSystem();
    }
    else if (state === 'PLAYING') { finishAnalysis(); }
    else if (state === 'REPORT') {
        let bY = height - 70;
        // Save/Back Button
        if (abs(mouseX - (width - 360)) < 100 && abs(mouseY - bY) < 20) {
            if (!fromArchive) saveToArchive();
            else { state = 'ARCHIVE'; archiveScrollY = 0; }
        }
        // Email Button - Open Custom Modal
        else if (abs(mouseX - (width - 150)) < 100 && abs(mouseY - bY) < 20) {
            showEmailModal = true;
            emailInput.style('display', 'block');
            emailInput.position(width / 2 - 150, height / 2);
            emailInput.size(230, 20);
            emailInput.value('RECIPIENT@MAIL.COM');
        }
        // Reset (Clicking elsewhere on left)
        else if (mouseX < width / 2 && mouseY < height - 100) {
            resetSystem();
        }
    }
    else if (state === 'ARCHIVE') {
        if (mouseX > width - 300 && mouseX < width - 150 && mouseY < 60) toggleFullScreen();
        if (mouseY > height - 100 && mouseX > width - 250) resetSystem();
        checkArchiveCardClick();
    }
}

function checkArchiveCardClick() {
    let cols = 5; let marginX = 60; let marginY = 120; let gutter = 60;
    let cardSize = (width - (marginX * 2) - (gutter * (cols - 1))) / cols;
    for (let i = 0; i < archive.length; i++) {
        let realIndex = archive.length - 1 - i; let item = archive[realIndex];
        let col = i % cols; let row = floor(i / cols);
        let x = marginX + (col * (cardSize + gutter));
        let y = marginY + (row * (cardSize + gutter)) + archiveScrollY;

        // Only check click if visible in the clipped area
        if (y + cardSize > 100 && y < height - 80) {
            if (mouseX > x && mouseX < x + cardSize && mouseY > y && mouseY < y + cardSize) {
                if (mouseX > x + cardSize - 25 && mouseY < y + 25) deleteItemFromArchive(realIndex);
                else {
                    analysisReport = item;
                    fromArchive = true;
                    state = 'REPORT';
                    reportStartTime = frameCount;
                }
                break;
            }
        }
    }
}

function resetSystem() { state = 'IDLE'; fromArchive = false; if (soundFile) { soundFile.stop(); } }
function resetStats() {
    stats = {
        volSum: 0, pitchSum: 0, frameCount: 0,
        volReadings: [], pitchReadings: [],
        silenceFrames: 0,
        pauseCount: 0, inPause: false,
        spectralTiltSum: 0,
        localDevPitch: 0, localDevVol: 0,
        syllableCount: 0, lastVol: 0,
        history: []
    };
}
function drawIdleUI() {
    fill(PALETTE.TEXT); textAlign(LEFT, TOP); textSize(16); text("SPEECH PATTERN PROFILING // LIVE FEED", 50, 40);
    let status = mic.getLevel() > 0.01 ? "SUBJECT DETECTED" : "AWAITING INPUT";
    text("STATUS: " + status, 50, 70);
    drawButton("ADD A FILE", 150, height - 80);

    textAlign(RIGHT, TOP); textSize(14);
    let isTopBar = mouseY < 80;

    fill(isTopBar && mouseX > width - 400 && mouseX < width - 260 ? 255 : 150);
    text("[ FULLSCREEN ]", width - 260, 40);

    fill(isTopBar && mouseX > width - 250 && mouseX < width - 150 ? 255 : 150);
    text("[ LEGEND ]", width - 150, 40);

    fill(isTopBar && mouseX > width - 140 ? 255 : 150);
    text("[ ARCHIVE ]", width - 50, 40);

    if (isTopBar && mouseX > width - 400) cursor(HAND);
}
function drawPlayingUI() {
    fill(PALETTE.TEXT); textAlign(LEFT, TOP); textSize(11); text("ANALYSIS IN PROGRESS...", 50, 40);
    if (soundFile && soundFile.isPlaying()) {
        let remaining = soundFile.duration() - soundFile.currentTime();
        text("T-MINUS: " + nf(remaining, 1, 2), 50, 70);
        let progress = map(soundFile.currentTime(), 0, soundFile.duration(), 0, width);
        stroke(PALETTE.TEXT); line(0, 105, progress, 105); noStroke();
    } else if (currentSource === "LIVE" && stats.silenceFrames > 60) {
        // PROMINENT LEFT COUNTDOWN
        let countdown = ceil((360 - stats.silenceFrames) / 60);
        if (countdown > 0) {
            textAlign(LEFT, CENTER);
            fill(255, 150); textSize(8);
            text("SILENCE DETECTED // FINALIZING IN:", 50, height - 100);
            textSize(24); fill(255);
            text(countdown, 50, height - 75);
            textAlign(LEFT, TOP); // Reset
        }
    }
}

function drawProcessingScreen() {
    background(0);
    drawGrid();

    // --- 1. FULL-SCREEN VISUAL REPLAY (HIGH SPEED) ---
    if (stats.history && stats.history.length > 0) {
        let speed = 1.0;
        let index = floor((frameCount * speed) % stats.history.length);
        let record = stats.history[index];

        push();
        translate(width / 2, height / 2);
        scale(1.5);
        let d_y = map(record.py || height / 2, 0, height, -100, 100);
        drawv58Cloud(0, d_y, record.sz || 6, (record.sc || 0) * 0.8, record.mo || "DRIFT", false, 0, color(255, 180), frameCount);
        pop();
    }

    // --- 2. HORIZONTAL SCANNER (TOP TO BOTTOM) ---
    let scanY = (frameCount * 6) % height;

    // Gradient glow for horizontal scanner
    for (let i = 0; i < 30; i++) {
        stroke(255, 100 - i * 3);
        line(0, scanY - i, width, scanY - i);
    }
    stroke(255, 180); strokeWeight(1);
    line(0, scanY, width, scanY); noStroke();

    // Corner Brackets (Keeping for framing)
    let bSize = 60; let m = 50;
    stroke(255, 150); noFill();
    line(m, m, m + bSize, m); line(m, m, m, m + bSize);
    line(width - m, m, width - m - bSize, m); line(width - m, m, width - m, m + bSize);
    line(m, height - m, m + bSize, height - m); line(m, height - m, m, height - m - bSize);
    line(width - m, height - m, width - m - bSize, height - m); line(width - m, height - m, width - m, height - m - bSize);

    // --- 4. CENTER STATUS LABELS ---
    textAlign(CENTER, CENTER);
    fill(255); textSize(18); textFont('Courier New Bold');
    let dots = floor(frameCount / 15) % 4;
    text("SYSTEM ANALYSIS IN PROGRESS" + ".".repeat(dots), width / 2, height - 120);

    textSize(10); fill(150);
    let labels = ["ARCHITECTURAL MAPPING", "PHONETIC DECONSTRUCTION", "SPECTRAL INTERPRETATION", "DIMENSIONAL RESOLUTION"];
    let currentLabel = labels[floor(map(frameCount - processingTimer, 0, 180, 0, labels.length - 0.1))];
    text("PHASE :: " + currentLabel, width / 2, height - 95);

    // Flickering "ANALYSIS" indicator at top
    if (frameCount % 30 < 5) {
        fill(255, 150);
        textSize(10);
        text("SCANNING SIGNAL STRUCTURE", width / 2, 80);
    }
}
function drawButton(label, x, y) {
    rectMode(CENTER); noStroke();

    let isHover = abs(mouseX - x) < 100 && abs(mouseY - y) < 20;

    if (isHover) fill(255, 50); else noFill();
    rect(x, y, 200, 40);
    fill(255); textAlign(CENTER, CENTER); textSize(12); text(label, x, y);
    rectMode(CORNER);
}
function loadArchiveFromLocal() {
    let d = localStorage.getItem(STORAGE_KEY);
    if (d) {
        archive = JSON.parse(d);
        // Migration: Rename all items to lvi_XX consistently
        for (let i = 0; i < archive.length; i++) {
            archive[i].id = "lvi_" + nf(i, 2);
        }
    }
}
function saveToArchive() { archive.push(analysisReport); localStorage.setItem(STORAGE_KEY, JSON.stringify(archive)); state = 'ARCHIVE'; }
function deleteItemFromArchive(i) { archive.splice(i, 1); localStorage.setItem(STORAGE_KEY, JSON.stringify(archive)); }

// --- FILE UPLOAD FIX ---
function handleFile(file) {
    // Restore fullscreen immediately on file selection (user gesture)
    if (expectingFullScreenAfterUpload) {
        fullscreen(true);
        expectingFullScreenAfterUpload = false;
    }

    if (file.type === 'audio') {
        currentSource = "FILE"; // Mark source as FILE
        if (soundFile) soundFile.stop();
        soundFile = loadSound(file.data, () => {
            // 1. STOP MIC LISTENING
            mic.stop();

            // 2. CONNECT ANALYZERS TO FILE
            amp.setInput(soundFile);
            fft.setInput(soundFile);

            // 3. START
            resetStats();
            state = 'PLAYING';
            soundFile.play();
        });
    }
}
function drawEmailModal() {
    fill(0, 220); rect(0, 0, width, height);
    let w = 400; let h = 200;
    let x = width / 2 - w / 2; let y = height / 2 - h / 2;

    // Aesthetic Box
    stroke(255, 50); fill(10); rect(x, y, w, h);
    noStroke(); fill(255); textAlign(LEFT, TOP); textSize(14);
    text(">> TRANSMIT FEEDBACK", x + 20, y + 20);

    textSize(10); fill(150);
    text("ENTER DESTINATION ADDRESS:", x + 20, y + 55);

    // Buttons inside modal
    drawButton("SEND", width / 2 + 130, height / 2 + 10);
    drawButton("CANCEL", width / 2, y + h - 30);
}

function handleEmailModalClick() {
    let w = 400; let h = 200;
    let x = width / 2 - w / 2; let y = height / 2 - h / 2;

    // SEND Button (using coordinates relative to width/2 + 130)
    if (abs(mouseX - (width / 2 + 130)) < 100 && abs(mouseY - (height / 2 + 10)) < 20) {
        let recipient = emailInput.value();
        let body = `Analysis for ${analysisReport.id}:\nPattern: ${analysisReport.primaryPattern}\nDominance: ${analysisReport.coreMetrics.dominance}%\nStability: ${analysisReport.coreMetrics.stability}%`;
        window.location.href = `mailto:${recipient}?subject=Active Intercept: ${analysisReport.id}&body=${encodeURIComponent(body)}`;
        closeEmailModal();
    }
    // CANCEL Button
    else if (abs(mouseX - (width / 2)) < 100 && abs(mouseY - (y + h - 30)) < 20) {
        closeEmailModal();
    }
    // Click outside
    else if (mouseX < x || mouseX > x + w || mouseY < y || mouseY > y + h) {
        closeEmailModal();
    }
}

function closeEmailModal() {
    showEmailModal = false;
    emailInput.style('display', 'none');
}

function drawGrid() { stroke(PALETTE.GRID); strokeWeight(1); for (let x = 0; x < width; x += gridScale)line(x, 0, x, height); for (let y = 0; y < height; y += gridScale)line(0, y, width, y); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
function toggleFullScreen() {
    let fs = fullscreen();
    fullscreen(!fs);
}

function mouseWheel(event) {
    if (state === 'ARCHIVE') {
        archiveScrollY -= event.delta;
        // Limit scrolling
        let rows = ceil(archive.length / 5);
        let cardSize = (width - 120 - (20 * 4)) / 5;
        let totalHeight = rows * (cardSize + 20) + 120;
        archiveScrollY = constrain(archiveScrollY, -(totalHeight - height + 100), 0);
    }
}
