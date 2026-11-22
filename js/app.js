(() => {
    "use strict";

    // ==========================================
    // CONSTANTS
    // ==========================================
    const STORAGE_KEY = "gluecksrad_v5";
    const LEGACY_KEYS = {
        students: "gluecksrad_students_de_v4",
        history: "gluecksrad_history_de_v4",
        wheelExcl: "gluecksrad_wheel_excl_v4",
        pairExcl: "gluecksrad_pair_excl_v4",
        pairs: "gluecksrad_pairs_list_v4"
    };
    const MAX_STUDENTS = 100;
    const MAX_CLASSES = 30;
    const NAME_MAX = 40;
    const WHEEL_COLORS = [
        "#6366f1", "#ec4899", "#10b981", "#f59e0b", "#3b82f6", "#8b5cf6",
        "#ef4444", "#14b8a6", "#f97316", "#06b6d4", "#84cc16", "#d946ef"
    ];
    const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ==========================================
    // HELPERS
    // ==========================================
    const $ = (id) => document.getElementById(id);

    function uid() {
        return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function cleanStr(s, max = NAME_MAX) {
        return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
    }

    function cryptoInt(max) {
        if (max <= 1) return 0;
        const c = window.crypto;
        if (c && c.getRandomValues) {
            const arr = new Uint32Array(1);
            const limit = 0xFFFFFFFF - ((0xFFFFFFFF + 1) % max);
            let v;
            do { c.getRandomValues(arr); v = arr[0]; } while (v > limit);
            return v % max;
        }
        return Math.floor(Math.random() * max);
    }

    function cryptoFloat() {
        const c = window.crypto;
        if (c && c.getRandomValues) {
            const arr = new Uint32Array(1);
            c.getRandomValues(arr);
            return arr[0] / 4294967296;
        }
        return Math.random();
    }

    function shuffle(array) {
        const a = [...array];
        for (let i = a.length - 1; i > 0; i--) {
            const j = cryptoInt(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function pickColor(i, n) {
        let idx = i % WHEEL_COLORS.length;
        // avoid same colour on the last and first slice
        if (n > 1 && i === n - 1 && idx === 0) idx = 6;
        return WHEEL_COLORS[idx];
    }

    // ==========================================
    // STATE
    // ==========================================
    let state;
    let activeMode = "wheel";
    let editMode = false;
    let searchQuery = "";
    let isSpinning = false;
    let isSlotSpinning = false;
    let currentRotation = 0;
    let wheelDisplay = null;      // list currently drawn on the wheel (kept after a spin so the wheel doesn't jump)
    let lastWinnerId = null;
    let lastPassedSlice = -1;
    let topicBag = [];

    function detectLang() {
        const l = (navigator.language || "de").toLowerCase();
        if (l.startsWith("de")) return "de";
        if (l.startsWith("ru") || l.startsWith("uk")) return "ru";
        return "en";
    }

    function t(key, vars) {
        const dict = window.I18N[state ? state.lang : "de"] || window.I18N.de;
        let s = dict[key];
        if (s === undefined) s = window.I18N.de[key];
        if (s === undefined) return key;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    }

    function makeClass(name, names) {
        return {
            id: uid(),
            name,
            students: (names || []).map((n) => ({ id: uid(), name: n, present: true })),
            history: [],
            wheelExcl: [],
            pairExcl: [],
            pairs: [],
            descExcl: [],
            descLog: []
        };
    }

    function sanitizeClass(c) {
        if (!c || typeof c !== "object") return null;
        const seen = new Set();
        const students = (Array.isArray(c.students) ? c.students : [])
            .map((s) => {
                let id = cleanStr(s && s.id, 60) || uid();
                if (seen.has(id)) id = uid();
                seen.add(id);
                return { id, name: cleanStr(s && s.name), present: !s || s.present !== false };
            })
            .filter((s) => s.name)
            .slice(0, MAX_STUDENTS);
        const ids = new Set(students.map((s) => s.id));
        const idList = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && ids.has(x)) : []);
        const strList = (a, max) => (Array.isArray(a) ? a.map((x) => cleanStr(x)).filter(Boolean).slice(0, max) : []);
        const pairs = (Array.isArray(c.pairs) ? c.pairs : [])
            .map((p, i) => ({
                id: cleanStr(p && p.id, 60) || uid(),
                n: Number.isFinite(p && p.n) ? p.n : i + 1,
                names: strList(p && p.names, 8),
                topic: cleanStr(p && p.topic, 100)
            }))
            .filter((p) => p.names.length)
            .slice(0, 300);
        return {
            id: cleanStr(c.id, 60) || uid(),
            name: cleanStr(c.name) || "–",
            students,
            history: strList(c.history, 200),
            wheelExcl: idList(c.wheelExcl),
            pairExcl: idList(c.pairExcl),
            pairs,
            descExcl: idList(c.descExcl),
            descLog: (Array.isArray(c.descLog) ? c.descLog : [])
                .map((x) => ({ n: cleanStr(x && x.n), t: cleanStr(x && x.t, 100), s: Number.isFinite(x && x.s) ? Math.max(0, Math.min(7200, Math.round(x.s))) : 0 }))
                .filter((x) => x.n || x.t || x.s)
                .slice(0, 200)
        };
    }

    function sanitizeTimes(p, base) {
        const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
        const tRed = num(p.tRed, base.tRed, 0.05, 30);
        const tYellow = Math.max(tRed + 0.05, num(p.tYellow, base.tYellow, 0.1, 30));
        let tMax = num(p.tMax, base.tMax, 0, 60);
        if (tMax > 0 && tMax <= tYellow) tMax = tYellow + 0.5;
        return { tRed, tYellow, tMax, tPrep: num(p.tPrep, base.tPrep, 0, 10) };
    }

    function defaultState() {
        const lang = detectLang();
        const cl = makeClass("", window.DEMO_NAMES);
        return {
            v: 5, lang, sound: true,
            excludeWheel: true, excludePairs: true,
            useTopics: false, groupSize: 2,
            topics: [...window.DEFAULT_TOPICS],
            picTopics: [...window.PIC_TOPICS],
            tRed: 1.5, tYellow: 3, tMax: 5, tPrep: 1,
            activeId: cl.id,
            classes: [cl],
            _needsDemoName: true
        };
    }

    function migrateLegacy() {
        // Carry over data from the previous single-class version (stays in the user's own browser).
        try {
            const raw = localStorage.getItem(LEGACY_KEYS.students) || localStorage.getItem("gluecksrad_students_de_v3");
            if (!raw) return null;
            const list = JSON.parse(raw);
            if (!Array.isArray(list) || !list.length) return null;
            const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
            const cl = sanitizeClass({
                name: "", students: list,
                history: read(LEGACY_KEYS.history),
                wheelExcl: read(LEGACY_KEYS.wheelExcl),
                pairExcl: read(LEGACY_KEYS.pairExcl),
                pairs: (read(LEGACY_KEYS.pairs) || []).map((p) => ({ id: p.id, names: p.names }))
            });
            if (!cl) return null;
            const st = defaultState();
            st.classes = [cl];
            st.activeId = cl.id;
            st._needsDefaultName = true;
            delete st._needsDemoName;
            return st;
        } catch (e) { return null; }
    }

    function loadState() {
        let st = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const p = JSON.parse(raw);
                const base = defaultState();
                const classes = (Array.isArray(p.classes) ? p.classes : []).map(sanitizeClass).filter(Boolean).slice(0, MAX_CLASSES);
                if (classes.length) {
                    st = {
                        v: 5,
                        lang: ["de", "en", "ru"].includes(p.lang) ? p.lang : base.lang,
                        sound: p.sound !== false,
                        excludeWheel: p.excludeWheel !== false,
                        excludePairs: p.excludePairs !== false,
                        useTopics: !!p.useTopics,
                        groupSize: [2, 3, 4].includes(p.groupSize) ? p.groupSize : 2,
                        topics: (Array.isArray(p.topics) ? p.topics : base.topics).map((x) => cleanStr(x, 100)).filter(Boolean).slice(0, 200),
                        picTopics: (Array.isArray(p.picTopics) && p.picTopics.length ? p.picTopics : base.picTopics).map((x) => cleanStr(x, 100)).filter(Boolean).slice(0, 300),
                        ...sanitizeTimes(p, base),
                        activeId: classes.some((c) => c.id === p.activeId) ? p.activeId : classes[0].id,
                        classes
                    };
                }
            }
        } catch (e) { /* ignore corrupt storage */ }
        if (!st) st = migrateLegacy();
        if (!st) st = defaultState();
        state = st;
        if (state._needsDemoName) { cls().name = t("class.demoName"); delete state._needsDemoName; }
        if (state._needsDefaultName) { cls().name = t("class.defaultName"); delete state._needsDefaultName; }
        save();
    }

    function save() {
        try {
            const out = Object.assign({}, state);
            delete out._needsDemoName; delete out._needsDefaultName;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
        } catch (e) { /* storage full or blocked */ }
    }

    const cls = () => state.classes.find((c) => c.id === state.activeId) || state.classes[0];
    const presentStudents = () => cls().students.filter((s) => s.present);
    const wheelEligible = () => {
        const c = cls();
        return c.students.filter((s) => s.present && !(state.excludeWheel && c.wheelExcl.includes(s.id)));
    };
    const pairEligible = () => {
        const c = cls();
        return c.students.filter((s) => s.present && !(state.excludePairs && c.pairExcl.includes(s.id)));
    };

    // ==========================================
    // i18n
    // ==========================================
    function applyI18n() {
        document.documentElement.lang = state.lang;
        document.title = t("app.title");
        $("appTitle").textContent = t("app.title");
        document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
        document.querySelectorAll("[data-i18n-title]").forEach((el) => {
            const v = t(el.dataset.i18nTitle);
            el.title = v;
            el.setAttribute("aria-label", v);
        });
        $("langSelect").value = state.lang;
        $("soundStatusText").textContent = state.sound ? t("sound.on") : t("sound.off");
        $("soundIcon").textContent = state.sound ? "🔊" : "🔇";
        $("editModeBtnText").textContent = editMode ? t("side.done") : t("side.edit");
        $("wheelCanvas").setAttribute("aria-label", t("mode.wheel"));
    }

    // ==========================================
    // SOUND
    // ==========================================
    let audioCtx = null;
    function initAudio() {
        if (!audioCtx) {
            const C = window.AudioContext || window.webkitAudioContext;
            if (C) audioCtx = new C();
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    }

    function blip(type, f0, f1, dur, vol) {
        if (!state.sound) return;
        try {
            initAudio();
            if (!audioCtx) return;
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f0, now);
            osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(now + dur + 0.005);
        } catch (e) { /* audio not available */ }
    }
    const playTick = (pitch = 620) => blip("triangle", pitch, 180, 0.035, 0.15);
    const playToggle = (on) => blip("sine", on ? 520 : 300, on ? 780 : 210, 0.08, 0.12);

    function playFanfare() {
        if (!state.sound) return;
        try {
            initAudio();
            if (!audioCtx) return;
            [523.25, 659.25, 783.99, 1046.5].forEach((freq, i, arr) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "triangle";
                const st = audioCtx.currentTime + i * 0.085;
                const d = i === arr.length - 1 ? 0.45 : 0.15;
                osc.frequency.setValueAtTime(freq, st);
                gain.gain.setValueAtTime(0.2, st);
                gain.gain.exponentialRampToValueAtTime(0.001, st + d);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(st); osc.stop(st + d);
            });
        } catch (e) { /* ignore */ }
    }

    // ==========================================
    // TOAST & DIALOG
    // ==========================================
    function toast(msg) {
        const el = $("statusToast");
        el.textContent = msg;
        el.classList.remove("hidden");
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.add("hidden"), 3200);
    }

    /** Opens the shared dialog. Resolves with the entered string (or true for confirm) or null if cancelled. */
    function openDialog({ title, hint = "", value = "", multiline = false, confirmOnly = false, okLabel, danger = false, password = false }) {
        return new Promise((resolve) => {
            const dlg = $("dlg"), form = $("dlgForm"), input = $("dlgInput"), text = $("dlgText");
            const ok = $("dlgOk"), cancel = $("dlgCancel");
            $("dlgTitle").textContent = title;
            $("dlgHint").textContent = hint;
            $("dlgHint").classList.toggle("hidden", !hint);
            input.classList.toggle("hidden", multiline || confirmOnly);
            text.classList.toggle("hidden", !multiline || confirmOnly);
            input.type = password ? "password" : "text";
            input.value = value;
            text.value = value;
            ok.textContent = okLabel || t("dlg.save");
            ok.className = "px-4 py-2 rounded-xl text-white text-xs font-bold transition " +
                (danger ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500");
            let done = false;
            const finish = (val) => {
                if (done) return;
                done = true;
                form.removeEventListener("submit", onSubmit);
                cancel.removeEventListener("click", onCancel);
                dlg.removeEventListener("cancel", onCancel);
                if (dlg.open) dlg.close();
                resolve(val);
            };
            const onSubmit = (e) => {
                e.preventDefault();
                finish(confirmOnly ? true : (multiline ? text.value : input.value));
            };
            const onCancel = (e) => { if (e && e.preventDefault) e.preventDefault(); finish(null); };
            form.addEventListener("submit", onSubmit);
            cancel.addEventListener("click", onCancel);
            dlg.addEventListener("cancel", onCancel);
            dlg.showModal();
            setTimeout(() => { (multiline ? text : input).focus(); if (!multiline) input.select(); }, 30);
        });
    }

    // ==========================================
    // MASTER UPDATE
    // ==========================================
    function updateAll(keepWheel = false) {
        if (!keepWheel && !isSpinning) { wheelDisplay = null; resetPointer(); }
        renderClassSelect();
        renderStudents();
        renderHistory();
        renderPairs();
        renderDesc();
        updateControls();
        drawWheel();
    }

    function updateControls() {
        const c = cls();
        const present = presentStudents();
        const wEl = wheelEligible();
        const pEl = pairEligible();
        $("attendanceCounter").textContent = `${present.length} / ${c.students.length}`;
        $("wheelActiveCounter").textContent = `${wEl.length} / ${present.length}`;
        $("pairPoolCounter").textContent = `${pEl.length} / ${present.length}`;

        const wCalled = present.filter((s) => c.wheelExcl.includes(s.id)).length;
        const pCalled = present.filter((s) => c.pairExcl.includes(s.id)).length;
        $("resetWheelRoundBtn").textContent = t("wheel.reset", { n: wCalled });
        $("resetWheelRoundBtn").disabled = wCalled === 0;
        $("resetPairPoolBtn").textContent = t("pairs.reset", { n: pCalled });
        $("resetPairPoolBtn").disabled = pCalled === 0;

        const canWheel = wEl.length > 0 && !isSpinning;
        $("mainSpinBtn").disabled = !canWheel;
        $("centerSpinBtn").disabled = !canWheel;
        const canPairs = pEl.length >= 2 && !isSlotSpinning;
        $("spinSlotPairBtn").disabled = !canPairs;
        $("splitAllClassBtn").disabled = !canPairs;

        $("excludeWheelCheckbox").checked = state.excludeWheel;
        $("excludePairsCheckbox").checked = state.excludePairs;
        $("useTopicsCheckbox").checked = state.useTopics;
        $("groupSizeSelect").value = String(state.groupSize);
        $("editTopicsBtn").classList.toggle("hidden", !state.useTopics);
    }

    // ==========================================
    // CLASSES
    // ==========================================
    function renderClassSelect() {
        const sel = $("classSelect");
        sel.innerHTML = "";
        state.classes.forEach((c) => {
            const o = document.createElement("option");
            o.value = c.id;
            o.textContent = c.name;
            sel.appendChild(o);
        });
        sel.value = state.activeId;
        $("deleteClassBtn").disabled = state.classes.length <= 1;
        $("deleteClassBtn").classList.toggle("opacity-40", state.classes.length <= 1);
    }

    async function newClass() {
        if (state.classes.length >= MAX_CLASSES) return;
        const name = cleanStr(await openDialog({ title: t("dlg.newClass"), hint: t("dlg.className"), okLabel: t("dlg.add") }) || "");
        if (!name) return;
        const c = makeClass(name, []);
        state.classes.push(c);
        state.activeId = c.id;
        resetSessionView();
        save(); updateAll();
    }

    async function renameClass() {
        const c = cls();
        const name = cleanStr(await openDialog({ title: t("dlg.renameClass"), hint: t("dlg.className"), value: c.name }) || "");
        if (!name) return;
        c.name = name;
        save(); updateAll();
    }

    async function deleteClass() {
        if (state.classes.length <= 1) return;
        const c = cls();
        const ok = await openDialog({
            title: t("dlg.deleteClassTitle"), hint: t("dlg.deleteClass", { name: c.name }),
            confirmOnly: true, okLabel: t("dlg.delete"), danger: true
        });
        if (!ok) return;
        state.classes = state.classes.filter((x) => x.id !== c.id);
        state.activeId = state.classes[0].id;
        resetSessionView();
        save(); updateAll();
        toast(t("toast.classDeleted"));
    }

    function resetSessionView() {
        descResetAll();
        wheelDisplay = null;
        $("winnerCard").classList.add("hidden");
        $("slotTopicBox").classList.add("hidden");
        resetSlotText();
        searchQuery = ""; $("searchStudentInput").value = "";
    }

    // ==========================================
    // ATTENDANCE LIST
    // ==========================================
    function renderStudents() {
        const c = cls();
        const box = $("studentListContainer");
        box.innerHTML = "";
        const q = searchQuery.trim().toLowerCase();

        if (c.students.length === 0) {
            const d = document.createElement("div");
            d.className = "text-center py-5 text-slate-500 text-xs";
            d.textContent = t("side.empty");
            box.appendChild(d);
            return;
        }

        let shown = 0;
        c.students.forEach((s, index) => {
            if (q && !s.name.toLowerCase().includes(q)) return;
            shown++;
            const wheelCalled = c.wheelExcl.includes(s.id);
            const pairCalled = c.pairExcl.includes(s.id);

            const row = document.createElement("div");
            row.className = `group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border transition select-none ${
                s.present ? "bg-slate-800/65 hover:bg-slate-800 border-slate-700/80 text-white"
                          : "bg-slate-900/40 hover:bg-slate-800/40 border-slate-800/60 text-slate-400"
            } ${editMode ? "" : "cursor-pointer"}`;
            if (!editMode) {
                row.setAttribute("role", "switch");
                row.setAttribute("aria-checked", String(s.present));
                row.tabIndex = 0;
                const toggle = () => togglePresence(s.id);
                row.addEventListener("click", toggle);
                row.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); }
                });
            }

            const left = document.createElement("div");
            left.className = "flex items-center gap-2 min-w-0 flex-1";
            const idx = document.createElement("span");
            idx.className = `w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0 ${
                s.present ? "bg-slate-700 text-slate-200" : "bg-slate-800/80 text-slate-500"}`;
            idx.textContent = index + 1;
            const wrap = document.createElement("div");
            wrap.className = "min-w-0 flex-1 flex items-center gap-1.5";
            const nm = document.createElement("span");
            nm.className = `font-semibold text-xs sm:text-sm truncate transition ${s.present ? "text-slate-100" : "line-through text-slate-500"}`;
            nm.textContent = s.name;
            wrap.appendChild(nm);
            if (s.present && !editMode) {
                if (wheelCalled) wrap.appendChild(badge(t("badge.wheel"), "bg-indigo-500/25 text-indigo-300 border-indigo-500/30"));
                if (pairCalled) wrap.appendChild(badge(t("badge.pair"), "bg-pink-500/25 text-pink-300 border-pink-500/30"));
            }
            left.appendChild(idx); left.appendChild(wrap);

            const right = document.createElement("div");
            right.className = "flex items-center gap-1.5 shrink-0";
            if (editMode) {
                right.appendChild(iconBtn("✏️", t("side.rename"), "hover:bg-indigo-600", () => renameStudent(s.id)));
                right.appendChild(iconBtn("🗑️", t("side.remove"), "hover:bg-rose-600", () => deleteStudent(s.id)));
            } else {
                const track = document.createElement("div");
                track.className = `w-11 h-6 rounded-full border p-0.5 flex items-center transition-all duration-300 ${
                    s.present ? "switch-track-green justify-end" : "switch-track-red justify-start"}`;
                const bulb = document.createElement("div");
                bulb.className = `w-4 h-4 rounded-full transition-all duration-300 ${s.present ? "bulb-green" : "bulb-red"}`;
                track.appendChild(bulb);
                right.appendChild(track);
            }
            row.appendChild(left); row.appendChild(right);
            box.appendChild(row);
        });

        if (shown === 0) {
            const d = document.createElement("div");
            d.className = "text-center py-5 text-slate-500 text-xs";
            d.textContent = t("side.notFound");
            box.appendChild(d);
        }
    }

    function badge(text, cls_) {
        const b = document.createElement("span");
        b.className = `text-[9px] font-bold px-1 rounded border shrink-0 ${cls_}`;
        b.textContent = text;
        return b;
    }

    function iconBtn(icon, label, hover, fn) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `p-1 rounded-lg bg-slate-700/80 ${hover} text-slate-200 hover:text-white text-xs transition`;
        b.title = label; b.setAttribute("aria-label", label);
        b.textContent = icon;
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        return b;
    }

    function busy() {
        if (isSpinning || isSlotSpinning) { toast(t("toast.waitSpin")); return true; }
        return false;
    }

    function togglePresence(id) {
        if (busy()) return;
        const s = cls().students.find((x) => x.id === id);
        if (!s) return;
        s.present = !s.present;
        playToggle(s.present);
        save(); updateAll();
    }

    async function renameStudent(id) {
        if (busy()) return;
        const s = cls().students.find((x) => x.id === id);
        if (!s) return;
        const name = cleanStr(await openDialog({ title: t("dlg.renameStudent"), hint: t("dlg.renameStudentHint"), value: s.name }) || "");
        if (!name) return;
        s.name = name;
        save(); updateAll(); toast(t("toast.renamed"));
    }

    function deleteStudent(id) {
        if (busy()) return;
        const c = cls();
        const s = c.students.find((x) => x.id === id);
        if (!s) return;
        c.students = c.students.filter((x) => x.id !== id);
        c.wheelExcl = c.wheelExcl.filter((x) => x !== id);
        c.pairExcl = c.pairExcl.filter((x) => x !== id);
        c.descExcl = c.descExcl.filter((x) => x !== id);
        save(); updateAll(); toast(t("toast.removed", { name: s.name }));
    }

    function addNames(names) {
        const c = cls();
        const have = new Set(c.students.map((s) => s.name.toLowerCase()));
        let added = 0, hitLimit = false;
        for (const raw of names) {
            const n = cleanStr(raw);
            if (!n || have.has(n.toLowerCase())) continue;
            if (c.students.length >= MAX_STUDENTS) { hitLimit = true; break; }
            c.students.push({ id: uid(), name: n, present: true });
            have.add(n.toLowerCase());
            added++;
        }
        if (added) { save(); updateAll(); }
        return { added, hitLimit };
    }

    // ==========================================
    // WHEEL
    // ==========================================
    const wheelCanvas = $("wheelCanvas");
    const ctx = wheelCanvas.getContext("2d");

    function resizeCanvas() {
        const box = wheelCanvas.parentElement;
        const size = Math.min(box.clientWidth, box.clientHeight) || 520;
        const dpr = window.devicePixelRatio || 1;
        wheelCanvas.width = size * dpr;
        wheelCanvas.height = size * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWheel();
    }

    function sliceUnderPointer(n) {
        if (n === 0) return -1;
        const slice = (2 * Math.PI) / n;
        const norm = ((((-Math.PI / 2) - currentRotation) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return Math.floor(norm / slice) % n;
    }

    function drawWheel() {
        const dpr = window.devicePixelRatio || 1;
        const w = wheelCanvas.width / dpr, h = wheelCanvas.height / dpr;
        if (!w || !h) return;
        const cx = w / 2, cy = h / 2;
        const radius = Math.min(cx, cy) - 14;
        ctx.clearRect(0, 0, w, h);

        const list = wheelDisplay || wheelEligible();

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 9, 0, 2 * Math.PI);
        ctx.fillStyle = "#1e293b"; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = "#64748b"; ctx.stroke();
        ctx.restore();

        const pointerEl = $("currentPointerName");

        if (list.length === 0) {
            const none = cls().students.length === 0;
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.fillStyle = "#0f172a"; ctx.fill();
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "800 17px system-ui, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(none ? t("wheel.noNames") : t("wheel.allCalled"), cx, cy - 12, radius * 1.6);
            ctx.font = "600 13px system-ui, sans-serif";
            ctx.fillStyle = "#94a3b8";
            ctx.fillText(none ? t("wheel.noNamesHint") : t("wheel.allCalledHint"), cx, cy + 14, radius * 1.6);
            ctx.restore();
            pointerEl.textContent = none ? t("wheel.ready") : t("wheel.roundDone");
            return;
        }

        const n = list.length;
        const slice = (2 * Math.PI) / n;
        const hi = sliceUnderPointer(n);
        if (hi >= 0 && list[hi]) pointerEl.textContent = list[hi].name;

        list.forEach((s, i) => {
            const a0 = currentRotation + i * slice, a1 = a0 + slice;
            ctx.save();
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, a0, a1); ctx.closePath();
            ctx.fillStyle = pickColor(i, n); ctx.fill();
            if (i === hi) { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill(); }
            ctx.lineWidth = n > 1 ? 2 : 0; ctx.strokeStyle = "#0f172a"; ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a0 + slice / 2);
            ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
            const fs = Math.max(11, Math.min(18, Math.floor((radius * 0.54) / Math.max(7.5, n * 0.45))));
            ctx.font = `800 ${fs}px system-ui, sans-serif`;
            ctx.shadowColor = "rgba(0,0,0,0.75)"; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
            const maxW = radius - 72;
            let label = s.name;
            while (ctx.measureText(label).width > maxW && label.length > 4) label = label.slice(0, -1);
            if (label !== s.name) label = label.trim() + "…";
            ctx.fillText(label, radius - 20, 0);
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a0) * (radius - 4), cy + Math.sin(a0) * (radius - 4), 4, 0, 2 * Math.PI);
            ctx.fillStyle = "#f8fafc"; ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 3; ctx.fill();
            ctx.restore();
        });
    }

    // ---- Pointer: a spring-loaded flapper that the wheel's pegs push aside, like on a real wheel ----
    const pointerEl = $("wheelPointer");
    pointerEl.style.transition = "none";
    const PTR_MAX = 0.46;                 // max deflection in rad (~26 deg)
    const PTR_K = 950, PTR_C = 20;        // spring stiffness & damping (slightly under-damped -> little wobble)
    const ptr = { th: 0, w: 0, raf: null, hold: null };

    function applyPointer() {
        pointerEl.style.transform = `rotate(${ptr.th}rad)`;
    }

    function resetPointer() {
        if (ptr.raf) cancelAnimationFrame(ptr.raf);
        ptr.raf = null; ptr.th = 0; ptr.w = 0; ptr.hold = null;
        applyPointer();
    }

    /** Deflection the pegs force on the pointer between two wheel angles (null = no contact).
     *  A peg touching the pointer's left edge pushes it to the right until it slips off the right edge. */
    function pegContact(prevRot, nowRot, n) {
        if (n < 1) return null;
        const dpr = window.devicePixelRatio || 1;
        const size = wheelCanvas.width / dpr;
        const pegR = Math.max(40, size / 2 - 14 - 4);
        const half = 13 / pegR;                       // half width of the pointer body at peg level (rad)
        const slice = (2 * Math.PI) / n;
        const TAU = 2 * Math.PI;
        const norm = (x) => { x = (x + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
        let req = null;
        for (let i = 0; i < n; i++) {
            const dPrev = norm(prevRot + i * slice + Math.PI / 2);
            const dNow = norm(nowRot + i * slice + Math.PI / 2);
            if (Math.abs(dNow - dPrev) > Math.PI) continue;          // wrapped around, no crossing
            const lo = Math.min(dPrev, dNow), hi = Math.max(dPrev, dNow);
            if (hi < -half || lo > half) continue;
            const depth = Math.min(1, Math.max(0, (dNow + half) / (2 * half)));
            const r = -PTR_MAX * depth;
            if (req === null || r < req) req = r;
        }
        return req;
    }

    function stepPointer(dt, req) {
        dt = Math.min(dt, 0.04);
        const steps = 3, h = dt / steps;
        for (let i = 0; i < steps; i++) {
            ptr.w += (-PTR_K * ptr.th - PTR_C * ptr.w) * h;
            ptr.th += ptr.w * h;
            if (req !== null && req !== undefined && ptr.th > req) { ptr.th = req; ptr.w = Math.min(ptr.w, 0); }
        }
        ptr.th = Math.max(-PTR_MAX, Math.min(0.25, ptr.th));
        applyPointer();
    }

    /** After the wheel stops: let the pointer swing back (or rest against the peg it stopped on). */
    function settlePointer(hold) {
        if (ptr.raf) cancelAnimationFrame(ptr.raf);
        ptr.hold = hold;
        let last = performance.now();
        const loop = (now) => {
            stepPointer((now - last) / 1000, ptr.hold);
            last = now;
            const target = ptr.hold === null ? 0 : ptr.hold;
            if (Math.abs(ptr.th - target) > 0.002 || Math.abs(ptr.w) > 0.02) ptr.raf = requestAnimationFrame(loop);
            else { ptr.th = target; ptr.w = 0; applyPointer(); ptr.raf = null; }
        };
        ptr.raf = requestAnimationFrame(loop);
    }

    function startSpin() {
        if (isSpinning) return;
        const list = wheelEligible();
        if (list.length === 0) {
            if (cls().students.length === 0) toast(t("toast.noNames"));
            return;
        }
        initAudio();
        isSpinning = true;
        wheelDisplay = list;
        $("winnerCard").classList.add("hidden");
        updateControls();

        const N = list.length;
        const winIdx = cryptoInt(N);
        const winner = list[winIdx];
        const slice = (2 * Math.PI) / N;
        const offset = (cryptoFloat() - 0.5) * 0.65 * slice;
        const winAngle = winIdx * slice + slice / 2 + offset;
        const TAU = 2 * Math.PI;
        const desired = ((((-Math.PI / 2) - winAngle) % TAU) + TAU) % TAU;
        const current = ((currentRotation % TAU) + TAU) % TAU;
        let delta = desired - current;
        if (delta <= 0) delta += TAU;
        const total = (4 + cryptoInt(3)) * TAU + delta;
        const start = currentRotation;
        const target = start + total;
        const duration = REDUCED_MOTION ? 900 : 5000;   // spin time; + 450 ms reveal pause
        const t0 = performance.now();
        lastPassedSlice = sliceUnderPointer(N);
        resetPointer();

        // Friction-like profile: short ramp-up (first 8 %), then velocity falls LINEARLY to zero
        // (constant deceleration, like a real wheel). Position is the exact integral -> ends exactly on `target`.
        const RAMP = 0.08;
        const posAt = (p) => (p < RAMP
            ? (2 * p * p) / (2 * RAMP)
            : RAMP + (1 - RAMP) * (1 - Math.pow((1 - p) / (1 - RAMP), 2)));
        const velAt = (p) => (p < RAMP ? p / RAMP : (1 - p) / (1 - RAMP));   // 0..1

        const wheelBox = wheelCanvas.parentElement;
        let lastTickAt = 0, tension = false, prevRot = currentRotation, prevNow = t0;

        function frame(now) {
            const p = Math.min(1, (now - t0) / duration);
            prevRot = currentRotation;
            currentRotation = start + total * posAt(p);
            const idx = sliceUnderPointer(N);
            if (idx !== lastPassedSlice && N > 1) {
                lastPassedSlice = idx;
                if (now - lastTickAt > 28) {                       // don't machine-gun the speaker at full speed
                    lastTickAt = now;
                    playTick(380 + 420 * velAt(p));                // pitch falls as the wheel slows down
                }
            }
            stepPointer((now - prevNow) / 1000, pegContact(prevRot, currentRotation, N));
            prevNow = now;
            if (!tension && p > 0.65) { tension = true; wheelBox.classList.add("wheel-tension"); }
            drawWheel();
            if (p < 1) requestAnimationFrame(frame);
            else {
                currentRotation = target;
                drawWheel();
                wheelBox.classList.remove("wheel-tension");
                settlePointer(pegContact(currentRotation, currentRotation, N));
                setTimeout(() => finishSpin(winner), REDUCED_MOTION ? 0 : 450);   // a beat of silence before the reveal
            }
        }
        requestAnimationFrame(frame);
    }

    function finishSpin(winner) {
        isSpinning = false;
        const c = cls();
        lastWinnerId = winner.id;
        $("winnerNameText").textContent = winner.name;
        if (state.excludeWheel) {
            if (!c.wheelExcl.includes(winner.id)) c.wheelExcl.push(winner.id);
            $("winnerSubStatusText").textContent = t("winner.removed");
            $("excludeWinnerBtn").classList.add("hidden");
            $("keepWinnerBtn").classList.remove("hidden");
        } else {
            $("winnerSubStatusText").textContent = t("winner.stays");
            $("excludeWinnerBtn").classList.remove("hidden");
            $("keepWinnerBtn").classList.add("hidden");
        }
        $("winnerCard").classList.remove("hidden");
        c.history.push(winner.name);
        if (c.history.length > 200) c.history.shift();
        save();
        updateAll(true);          // keep the wheel as it was; the winner disappears at the next spin
        playFanfare(); confetti();
    }

    function renderHistory() {
        const c = cls();
        const box = $("historyContainer");
        if (c.history.length === 0) { box.classList.add("hidden"); return; }
        box.classList.remove("hidden");
        const wrap = $("historyBadges");
        wrap.innerHTML = "";
        c.history.forEach((name, i) => {
            const b = document.createElement("span");
            b.className = "px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium";
            b.textContent = `${i + 1}. ${name}`;
            wrap.appendChild(b);
        });
    }

    // ==========================================
    // PAIRS & GROUPS
    // ==========================================
    function nextTopic() {
        if (!state.useTopics || state.topics.length === 0) return "";
        if (topicBag.length === 0) topicBag = shuffle(state.topics);
        return topicBag.pop();
    }

    function nextPairNumber() {
        return cls().pairs.reduce((m, p) => Math.max(m, p.n), 0) + 1;
    }

    function resetSlotText() {
        ["1", "2"].forEach((k) => {
            $("slotReel" + k + "Main").textContent = "—";
            $("slotReel" + k + "Main").classList.remove("text-emerald-400");
            $("slotReel" + k + "Top").textContent = "—";
            $("slotReel" + k + "Bottom").textContent = "—";
        });
    }

    function showSlotTopic(topic) {
        const box = $("slotTopicBox");
        if (topic) { $("slotTopic").textContent = topic; box.classList.remove("hidden"); }
        else box.classList.add("hidden");
    }

    function spinPairSlot() {
        const pool = pairEligible();
        if (isSlotSpinning) return;
        if (pool.length < 2) { toast(t("toast.needTwo")); return; }
        initAudio();
        isSlotSpinning = true;
        updateControls();
        showSlotTopic("");

        const sh = shuffle(pool);
        const A = sh[0], B = sh[1];
        const w1 = $("slotWindow1"), w2 = $("slotWindow2");
        const m1 = $("slotReel1Main"), m2 = $("slotReel2Main");
        w1.classList.add("slot-window-active"); w2.classList.add("slot-window-active");
        m1.classList.remove("text-emerald-400"); m2.classList.remove("text-emerald-400");
        m1.classList.add("slot-blur", "text-indigo-300"); m2.classList.add("slot-blur", "text-pink-300");
        $("slotCenterBadge").classList.add("animate-bounce");

        const rnd = () => pool[cryptoInt(pool.length)].name;
        const t0 = performance.now();
        const d1 = REDUCED_MOTION ? 400 : 1650, d2 = REDUCED_MOTION ? 700 : 2500;
        let lastTick = 0, stopped1 = false;

        function frame(now) {
            const el = now - t0;
            if (now - lastTick > 70) {
                lastTick = now;
                playTick(el < d1 ? 720 : 550);
                if (el < d1) { m1.textContent = rnd(); $("slotReel1Top").textContent = rnd(); $("slotReel1Bottom").textContent = rnd(); }
                if (el < d2) { m2.textContent = rnd(); $("slotReel2Top").textContent = rnd(); $("slotReel2Bottom").textContent = rnd(); }
            }
            if (el >= d1 && !stopped1) {
                stopped1 = true;
                w1.classList.remove("slot-window-active");
                m1.classList.remove("slot-blur", "text-indigo-300"); m1.classList.add("text-emerald-400");
                m1.textContent = A.name;
                $("slotReel1Top").textContent = t("pairs.selected");
                $("slotReel1Bottom").textContent = t("pairs.partnerA");
                playToggle(true);
            }
            if (el < d2) { requestAnimationFrame(frame); return; }
            w2.classList.remove("slot-window-active");
            m2.classList.remove("slot-blur", "text-pink-300"); m2.classList.add("text-emerald-400");
            m2.textContent = B.name;
            $("slotReel2Top").textContent = t("pairs.selected");
            $("slotReel2Bottom").textContent = t("pairs.partnerB");
            $("slotCenterBadge").classList.remove("animate-bounce");
            finishSlot(A, B);
        }
        requestAnimationFrame(frame);
    }

    function finishSlot(A, B) {
        isSlotSpinning = false;
        const c = cls();
        if (state.excludePairs) { c.pairExcl.push(A.id, B.id); }
        const topic = nextTopic();
        c.pairs.unshift({ id: uid(), n: nextPairNumber(), names: [A.name, B.name], topic });
        showSlotTopic(topic);
        save(); updateAll(true);
        playFanfare(); confetti();
    }

    /** Split into ceil(N/size) groups, spread evenly (sizes differ by at most 1), never leaving a lone person if avoidable. */
    function makeGroups(list, size) {
        const sh = shuffle(list);
        let g = Math.max(1, Math.ceil(sh.length / size));
        while (g > 1 && Math.floor(sh.length / g) < 2) g--;
        const groups = Array.from({ length: g }, () => []);
        sh.forEach((s, i) => groups[i % g].push(s.name));
        return groups;
    }

    function splitClass() {
        const pool = pairEligible();
        if (isSlotSpinning) return;
        if (pool.length < 2) { toast(t("toast.needTwo")); return; }
        initAudio();
        const c = cls();
        const groups = makeGroups(pool, state.groupSize);
        let n = nextPairNumber();
        const records = groups.map((names) => ({ id: uid(), n: n++, names, topic: nextTopic() }));
        if (state.excludePairs) pool.forEach((s) => { if (!c.pairExcl.includes(s.id)) c.pairExcl.push(s.id); });
        c.pairs = [...records, ...c.pairs].slice(0, 300);

        if (records[0].names.length >= 2) {
            $("slotReel1Main").classList.add("text-emerald-400"); $("slotReel2Main").classList.add("text-emerald-400");
            $("slotReel1Main").textContent = records[0].names[0];
            $("slotReel2Main").textContent = records[0].names[1];
            $("slotReel1Top").textContent = $("slotReel2Top").textContent = t("pairs.pairNo", { n: records[0].n });
            $("slotReel1Bottom").textContent = t("pairs.partnerA");
            $("slotReel2Bottom").textContent = t("pairs.partnerB");
            showSlotTopic(records[0].topic);
        }
        save(); updateAll(true);
        playFanfare(); confetti();
        toast(t("toast.groupsMade", { n: records.length }));
    }

    function groupLabel(size) {
        if (size === 1) return t("label.single");
        if (size === 2) return t("label.pair");
        return t("label.group", { n: size });
    }

    function renderPairs() {
        const c = cls();
        $("pairsHistoryCountBadge").textContent = c.pairs.length;
        const box = $("pairsSessionList");
        box.innerHTML = "";
        if (c.pairs.length === 0) {
            const d = document.createElement("div");
            d.className = "col-span-full text-center py-6 bg-slate-950/40 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-xs sm:text-sm";
            d.textContent = t("pairs.empty");
            box.appendChild(d);
            return;
        }
        c.pairs.forEach((p) => {
            const card = document.createElement("div");
            card.className = "bg-slate-950/85 border border-slate-800/90 rounded-2xl p-3 shadow-lg flex flex-col justify-between gap-2 animate-pop-in";

            const top = document.createElement("div");
            top.className = "flex items-center justify-between text-[11px] font-bold uppercase tracking-wider";
            const l = document.createElement("span");
            l.className = "text-indigo-400";
            l.textContent = p.names.length > 2 ? t("pairs.groupNo", { n: p.n }) : t("pairs.pairNo", { n: p.n });
            const r = document.createElement("span");
            r.className = "px-2 py-0.5 rounded bg-slate-800 text-slate-300";
            r.textContent = groupLabel(p.names.length);
            top.appendChild(l); top.appendChild(r);

            const names = document.createElement("div");
            names.className = "flex flex-col gap-1.5 mt-0.5";
            p.names.forEach((name, i) => {
                const pill = document.createElement("div");
                pill.className = "bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-white font-bold text-sm flex items-center gap-2";
                const dot = document.createElement("span");
                dot.className = "w-2 h-2 rounded-full shrink-0 " + ["bg-indigo-400", "bg-pink-400", "bg-amber-400", "bg-emerald-400"][i % 4];
                const txt = document.createElement("span");
                txt.className = "truncate"; txt.textContent = name;
                pill.appendChild(dot); pill.appendChild(txt);
                names.appendChild(pill);
            });

            card.appendChild(top); card.appendChild(names);
            if (p.topic) {
                const tp = document.createElement("div");
                tp.className = "text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-1.5";
                tp.textContent = "💡 " + p.topic;
                card.appendChild(tp);
            }
            box.appendChild(card);
        });
    }

    async function copyPairs() {
        const c = cls();
        if (!c.pairs.length) return;
        const lines = [...c.pairs].sort((a, b) => a.n - b.n).map((p) => {
            const head = p.names.length > 2 ? t("pairs.groupNo", { n: p.n }) : t("pairs.pairNo", { n: p.n });
            return `${head}: ${p.names.join(" – ")}${p.topic ? "  (" + p.topic + ")" : ""}`;
        });
        try { await navigator.clipboard.writeText(lines.join("\n")); toast(t("toast.copied")); }
        catch (e) { toast(t("toast.copyFail")); }
    }

    // ==========================================
    // BACKUP
    // ==========================================
    function exportBackup() {
        const data = JSON.stringify({ app: "gluecksrad", v: 5, topics: state.topics, picTopics: state.picTopics, classes: state.classes }, null, 2);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
        a.download = `gluecksrad-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function importBackup(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const p = JSON.parse(String(reader.result));
                if (!p || p.app !== "gluecksrad" || !Array.isArray(p.classes)) throw new Error("bad");
                const incoming = p.classes.map(sanitizeClass).filter(Boolean)
                    .slice(0, Math.max(0, MAX_CLASSES - state.classes.length));
                if (!incoming.length) throw new Error("empty");
                incoming.forEach((c) => {
                    // new ids so nothing collides with existing data
                    const map = new Map();
                    c.id = uid();
                    c.students.forEach((s) => { const nid = uid(); map.set(s.id, nid); s.id = nid; });
                    c.wheelExcl = c.wheelExcl.map((x) => map.get(x)).filter(Boolean);
                    c.pairExcl = c.pairExcl.map((x) => map.get(x)).filter(Boolean);
                    c.descExcl = c.descExcl.map((x) => map.get(x)).filter(Boolean);
                });
                state.classes.push(...incoming);
                state.activeId = incoming[0].id;
                resetSessionView();
                save(); updateAll();
                toast(t("toast.backupLoaded", { n: incoming.length }));
            } catch (e) { toast(t("toast.backupBad")); }
        };
        reader.readAsText(file);
    }

    // ==========================================
    // SHARE LINK  (no server: data lives in the URL fragment, which browsers never send;
    // optionally encrypted with AES-GCM, key derived from a password via PBKDF2)
    // ==========================================
    const b64u = {
        enc(bytes) {
            let s = "";
            bytes.forEach((b) => { s += String.fromCharCode(b); });
            return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        },
        dec(str) {
            const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
            return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
        }
    };

    async function pipeBytes(bytes, stream) {
        const w = stream.writable.getWriter();
        w.write(bytes); w.close();
        return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    }
    const deflate = (b) => pipeBytes(b, new CompressionStream("deflate-raw"));
    const inflate = (b) => pipeBytes(b, new DecompressionStream("deflate-raw"));

    async function deriveKey(pw, salt) {
        const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
            base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
        );
    }

    async function buildShareLink(c, password) {
        const absent = [];
        c.students.forEach((s, i) => { if (!s.present) absent.push(i); });
        const payload = { n: c.name, s: c.students.map((s) => s.name), a: absent };
        let bytes = await deflate(new TextEncoder().encode(JSON.stringify(payload)));
        let prefix = "c=";
        if (password) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await deriveKey(password, salt);
            const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
            bytes = new Uint8Array(16 + 12 + ct.length);
            bytes.set(salt, 0); bytes.set(iv, 16); bytes.set(ct, 28);
            prefix = "e=";
        }
        return location.origin + location.pathname + "#" + prefix + b64u.enc(bytes);
    }

    async function parseShare(hash, password) {
        const encrypted = hash.startsWith("#e=");
        let bytes = b64u.dec(hash.slice(3));
        if (encrypted) {
            const salt = bytes.slice(0, 16), iv = bytes.slice(16, 28), ct = bytes.slice(28);
            const key = await deriveKey(password || "", salt);
            bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
        }
        const p = JSON.parse(new TextDecoder().decode(await inflate(bytes)));
        const absent = new Set(Array.isArray(p.a) ? p.a : []);
        const students = (Array.isArray(p.s) ? p.s : []).map((n, i) => ({ name: n, present: !absent.has(i) }));
        const c = sanitizeClass({ name: p.n, students });
        if (!c || !c.students.length) throw new Error("empty");
        return c;
    }

    async function shareClass() {
        if (!window.CompressionStream) { toast(t("toast.shareBad")); return; }
        const pw = await openDialog({ title: t("dlg.shareTitle"), hint: t("dlg.shareHint"), password: true, okLabel: t("dlg.shareCreate") });
        if (pw === null) return;
        if (pw && !(window.crypto && crypto.subtle)) { toast(t("toast.shareBad")); return; }
        const link = await buildShareLink(cls(), pw);
        try { await navigator.clipboard.writeText(link); toast(t("toast.shareCopied")); } catch (e) { /* user copies manually */ }
        await openDialog({ title: t("dlg.shareLinkTitle"), hint: t("dlg.shareLinkHint"), value: link, multiline: true, okLabel: t("dlg.ok") });
    }

    let importingShare = false;
    async function handleIncomingShare() {
        const h = location.hash;
        if (importingShare || !/^#[ce]=/.test(h)) return;
        importingShare = true;
        try {
            let c = null;
            if (h.startsWith("#e=")) {
                for (let tries = 0; tries < 3 && !c; tries++) {
                    const pw = await openDialog({ title: t("dlg.pwTitle"), hint: t("dlg.pwHint"), password: true, okLabel: t("dlg.ok") });
                    if (pw === null) break;
                    try { c = await parseShare(h, pw); } catch (e) { toast(t("toast.pwWrong")); }
                }
            } else {
                c = await parseShare(h);
            }
            if (c) {
                if (state.classes.length >= MAX_CLASSES) { toast(t("toast.classLimit", { n: MAX_CLASSES })); }
                else {
                    const ok = await openDialog({
                        title: t("dlg.importTitle"), hint: t("dlg.importHint", { name: c.name, n: c.students.length }),
                        confirmOnly: true, okLabel: t("dlg.importBtn")
                    });
                    if (ok) {
                        state.classes.push(c);
                        state.activeId = c.id;
                        resetSessionView();
                        save(); updateAll();
                        toast(t("toast.shareImported", { name: c.name }));
                    }
                }
            }
        } catch (e) {
            toast(t("toast.shareBad"));
        }
        history.replaceState(null, "", location.pathname + location.search);
        importingShare = false;
    }

    // ==========================================
    // CONFETTI
    // ==========================================
    const cCanvas = $("confettiCanvas");
    const cCtx = cCanvas.getContext("2d");
    let particles = [], confettiRaf = null;

    function confetti() {
        if (REDUCED_MOTION) return;
        cCanvas.width = window.innerWidth; cCanvas.height = window.innerHeight;
        particles = Array.from({ length: 85 }, () => ({
            x: window.innerWidth / 2 + (Math.random() - 0.5) * 260,
            y: window.innerHeight / 2 - 60,
            vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4,
            size: Math.random() * 8 + 5,
            color: WHEEL_COLORS[Math.floor(Math.random() * WHEEL_COLORS.length)],
            rot: Math.random() * 360, vr: (Math.random() - 0.5) * 10
        }));
        if (confettiRaf) cancelAnimationFrame(confettiRaf);
        stepConfetti();
    }

    function stepConfetti() {
        cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);
        particles.forEach((p) => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.vx *= 0.99; p.rot += p.vr;
            cCtx.save();
            cCtx.translate(p.x, p.y); cCtx.rotate((p.rot * Math.PI) / 180);
            cCtx.fillStyle = p.color; cCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
            cCtx.restore();
        });
        particles = particles.filter((p) => p.y < cCanvas.height + 30);
        if (particles.length) confettiRaf = requestAnimationFrame(stepConfetti);
        else cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);
    }

    // ==========================================
    // PICTURE DESCRIPTION: topic / picture / speaker draw + speaking timer
    // ==========================================
    const TZ_CARD = {
        idle: "bg-slate-900/70 border-slate-700", prep: "bg-sky-950/70 border-sky-500/70",
        red: "bg-rose-950/70 border-rose-500", yellow: "bg-amber-950/70 border-amber-400",
        green: "bg-emerald-950/70 border-emerald-400", over: "bg-fuchsia-950/70 border-fuchsia-400"
    };
    const TZ_TEXT = {
        idle: "text-slate-200", prep: "text-sky-300", red: "text-rose-300",
        yellow: "text-amber-300", green: "text-emerald-300", over: "text-fuchsia-300"
    };
    const TZ_DOT = { red: "bg-rose-500", yellow: "bg-amber-400", green: "bg-emerald-500", over: "bg-fuchsia-500" };

    const tm = { phase: "idle", t0: 0, acc: 0, prepEnd: 0, iv: null, zone: "red" };   // idle | prep | running | paused | done
    let descBag = [], descImgBag = [], descImages = [], descSets = {}, descSetBag = [], descBuiltin = false, builtinTried = false, descCurrent = null, descSpeaker = "", descBusy = false;

    const fmtTime = (sec, ceil) => {
        const v = Math.max(0, ceil ? Math.ceil(sec) : Math.floor(sec));
        return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
    };

    function zoneOf(sec) {
        if (state.tMax > 0 && sec >= state.tMax * 60) return "over";
        if (sec < state.tRed * 60) return "red";
        if (sec < state.tYellow * 60) return "yellow";
        return "green";
    }

    const elapsedMs = () => (tm.phase === "running" ? tm.acc + (performance.now() - tm.t0) : tm.acc);

    function setTimerInterval(on) {
        if (tm.iv) { clearInterval(tm.iv); tm.iv = null; }
        if (on) tm.iv = setInterval(tick, 100);
    }

    function cue(zone) {
        if (zone === "yellow") blip("sine", 600, 900, 0.18, 0.15);
        else if (zone === "green") playFanfare();
        else if (zone === "over") [0, 220, 440].forEach((d) => setTimeout(() => blip("triangle", 880, 700, 0.16, 0.18), d));
    }

    function beginRun() {
        tm.phase = "running"; tm.t0 = performance.now(); tm.acc = 0; tm.zone = "red";
        blip("sine", 500, 800, 0.12, 0.14);
        setTimerInterval(true);
        renderTimer();
    }

    function timerMain() {
        initAudio();
        if (tm.phase === "idle" || tm.phase === "done") {
            tm.acc = 0;
            if (state.tPrep > 0) {
                tm.phase = "prep"; tm.prepEnd = performance.now() + state.tPrep * 60000;
                setTimerInterval(true); renderTimer();
            } else beginRun();
        } else if (tm.phase === "prep") {
            beginRun();                                           // skip preparation
        } else if (tm.phase === "running") {
            tm.acc = elapsedMs(); tm.phase = "paused"; setTimerInterval(false); renderTimer();
        } else if (tm.phase === "paused") {
            tm.phase = "running"; tm.t0 = performance.now(); setTimerInterval(true); renderTimer();
        }
    }

    function timerStop() {
        if (tm.phase !== "running" && tm.phase !== "paused") return;
        tm.acc = elapsedMs(); tm.phase = "done"; setTimerInterval(false);
        const c = cls();
        c.descLog.unshift({
            n: descSpeaker || "–",
            t: descCurrent ? descCurrent.label : "",
            s: Math.round(tm.acc / 1000)
        });
        if (c.descLog.length > 200) c.descLog.length = 200;
        save(); renderTimer(); renderDescLog();
    }

    function timerReset() {
        tm.phase = "idle"; tm.acc = 0; setTimerInterval(false); renderTimer();
    }

    function tick() {
        if (tm.phase === "prep") {
            if (performance.now() >= tm.prepEnd) { beginRun(); return; }
        } else if (tm.phase === "running") {
            const z = zoneOf(elapsedMs() / 1000);
            if (z !== tm.zone) { tm.zone = z; cue(z); }
        }
        renderTimer();
    }

    function renderTimer() {
        const sec = elapsedMs() / 1000;
        let zone, shown, label;
        if (tm.phase === "prep") { zone = "prep"; shown = fmtTime((tm.prepEnd - performance.now()) / 1000, true); label = t("desc.prep"); }
        else if (tm.phase === "idle") { zone = "idle"; shown = "0:00"; label = t("desc.ready"); }
        else { zone = zoneOf(sec); shown = fmtTime(sec); label = t("desc.zone." + zone); }

        $("timerCard").className = "rounded-3xl p-5 border-2 flex flex-col gap-3 shadow-xl transition-colors duration-500 " + TZ_CARD[zone];
        $("timerDigits").className = "text-7xl sm:text-8xl font-black tabular-nums tracking-tight leading-none my-2 " + TZ_TEXT[zone] + (zone === "over" ? " animate-pulse" : "");
        $("timerLabel").className = "text-xs sm:text-sm font-extrabold uppercase tracking-widest " + TZ_TEXT[zone];
        $("timerDigits").textContent = shown;
        $("timerLabel").textContent = label;
        $("timerTip").textContent = window.PIC_TIPS[zone] || "";

        const main = $("timerMainBtn");
        main.textContent = tm.phase === "prep" ? t("desc.skipPrep")
            : tm.phase === "running" ? t("desc.pause")
            : tm.phase === "paused" ? t("desc.resume") : t("desc.start");
        $("timerStopBtn").disabled = !(tm.phase === "running" || tm.phase === "paused");
        $("timerResetBtn").disabled = tm.phase === "idle";

        const span = timerSpan() * 60;
        const pct = tm.phase === "prep" || tm.phase === "idle" ? 0 : Math.min(100, (sec / span) * 100);
        $("timerShade").style.width = (100 - pct) + "%";
        $("timerMark").style.left = `calc(${pct}% - 2px)`;
    }

    const timerSpan = () => (state.tMax > 0 ? state.tMax : state.tYellow * 1.34);

    function renderTimerSettings() {
        const span = timerSpan();
        const r = (state.tRed / span) * 100, y = (state.tYellow / span) * 100;
        $("timerBar").style.background = `linear-gradient(to right, #f43f5e 0 ${r}%, #fbbf24 ${r}% ${y}%, #10b981 ${y}% 100%)`;
        const ticks = $("timerTicks");
        ticks.innerHTML = "";
        const addTick = (min, extra) => {
            const el = document.createElement("span");
            el.className = "absolute -translate-x-1/2 " + (extra || "");
            el.style.left = Math.min(98, (min / span) * 100) + "%";
            el.textContent = fmtTime(min * 60);
            ticks.appendChild(el);
        };
        addTick(state.tRed); addTick(state.tYellow);
        if (state.tMax > 0) addTick(state.tMax, "text-fuchsia-300");
        const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
        setVal("setRedEnd", state.tRed); setVal("setYellowEnd", state.tYellow);
        setVal("setMax", state.tMax); setVal("setPrep", state.tPrep);
    }

    function readTimeSettings() {
        const n = (id) => parseFloat($(id).value.replace(",", "."));
        Object.assign(state, sanitizeTimes(
            { tRed: n("setRedEnd"), tYellow: n("setYellowEnd"), tMax: n("setMax"), tPrep: n("setPrep") },
            { tRed: state.tRed, tYellow: state.tYellow, tMax: state.tMax, tPrep: state.tPrep }
        ));
        save();
        ["setRedEnd", "setYellowEnd", "setMax", "setPrep"].forEach((id) => { $(id).blur && 0; });
        renderTimerSettings(); renderTimer();
    }

    // ----- topic / picture draw -----
    function showTopic(label, fromSelect) {
        descCurrent = { kind: "topic", label };
        $("descImage").classList.add("hidden");
        $("descImageCap").classList.add("hidden");
        $("descTopicText").classList.remove("hidden");
        $("descTopicText").textContent = label;
        const link = $("descSearchLink");
        link.href = "https://duckduckgo.com/?iax=images&ia=images&q=" + encodeURIComponent(label);
        link.classList.remove("hidden");
        if (!fromSelect) $("descTopicSelect").value = "";
        renderDescCounters();
    }

    function drawTopic() {
        if (descBusy) return;
        if (!state.picTopics.length) { editPicTopics(); return; }
        initAudio();
        if (!descBag.length) descBag = shuffle(state.picTopics);
        const pick = descBag.pop();
        descBusy = true;
        $("descImage").classList.add("hidden");
        $("descTopicText").classList.remove("hidden");
        const list = state.picTopics;
        let n = 0;
        const iv = setInterval(() => {
            $("descTopicText").textContent = list[cryptoInt(list.length)];
            playTick(500 + (n % 3) * 90);
            if (++n >= (REDUCED_MOTION ? 2 : 14)) {
                clearInterval(iv);
                descBusy = false;
                showTopic(pick);
                playFanfare();
            }
        }, 75);
    }

    function drawImage() {
        if (descBusy) return;
        const themes = Object.keys(descSets);
        let img, caption = "";
        if (themes.length) {
            if (!descSetBag.length) descSetBag = shuffle(themes);
            caption = descSetBag.pop();
            const pics = descSets[caption];
            img = pics[cryptoInt(pics.length)];
        } else if (descImages.length) {
            if (!descImgBag.length) descImgBag = shuffle(descImages.map((_, i) => i));
            img = descImages[descImgBag.pop()];
        } else { toast(t("toast.noImages")); return; }
        initAudio();
        descCurrent = { kind: "image", label: caption || `${t("desc.imageLabel")}: ${img.name}` };
        $("descTopicText").classList.add("hidden");
        const el = $("descImage");
        el.classList.remove("hidden");
        el.classList.remove("animate-pop-in"); void el.offsetWidth; el.classList.add("animate-pop-in");
        el.src = img.url;
        el.alt = descCurrent.label;
        const cap = $("descImageCap");
        cap.textContent = caption;
        cap.classList.toggle("hidden", !caption);
        $("descSearchLink").classList.add("hidden");
        $("descTopicSelect").value = "";
        playFanfare();
        renderDescCounters();
    }

    async function loadBuiltinPics() {
        if (builtinTried) return;
        builtinTried = true;
        try {
            const res = await fetch("images/manifest.json", { cache: "no-cache" });
            if (!res.ok) return;
            const man = await res.json();
            if (Object.keys(descSets).length) return;
            Object.keys(man).forEach((slug) => {
                const m = man[slug];
                if (!m || !Array.isArray(m.files) || !m.files.length) return;
                descSets[cleanStr(m.title, 80)] = m.files.map((f) => ({ url: `images/${slug}/${f}`, name: f }));
            });
            descBuiltin = Object.keys(descSets).length > 0;
            renderDescCounters();
        } catch (e) { /* offline or no images: fine */ }
    }

    function loadFolder(files) {
        let ok = 0;
        if (descBuiltin) { descSets = {}; descBuiltin = false; }
        const before = Object.keys(descSets).length;
        Array.from(files).forEach((f) => {
            if (!f.type.startsWith("image/") || f.size > 20 * 1024 * 1024 || ok >= 2000) return;
            const parts = (f.webkitRelativePath || f.name).split("/");
            const theme = cleanStr(parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : "–", 80) || "–";
            (descSets[theme] = descSets[theme] || []).push({ url: URL.createObjectURL(f), name: cleanStr(f.name, 40) });
            ok++;
        });
        descSetBag = [];
        toast(t("toast.folderLoaded", { n: ok, k: Object.keys(descSets).length }));
        renderDescCounters();
    }

    function loadImages(files) {
        let ok = 0, skipped = 0;
        Array.from(files).forEach((f) => {
            if (!f.type.startsWith("image/") || f.size > 20 * 1024 * 1024 || descImages.length >= 40) { skipped++; return; }
            descImages.push({ url: URL.createObjectURL(f), name: cleanStr(f.name.replace(/\.[^.]+$/, ""), 30) || "–" });
            ok++;
        });
        descImgBag = [];
        if (ok) toast(t("toast.imagesLoaded", { n: ok }));
        if (skipped) setTimeout(() => toast(t("toast.imagesSkipped")), ok ? 3300 : 0);
        renderDescCounters();
    }

    function clearImages() {
        descImages.forEach((i) => URL.revokeObjectURL(i.url));
        Object.values(descSets).forEach((arr) => arr.forEach((i) => URL.revokeObjectURL(i.url)));
        descImages = []; descImgBag = []; descSets = {}; descSetBag = []; descBuiltin = false;
        $("descImageCap").classList.add("hidden");
        if (descCurrent && descCurrent.kind === "image") {
            descCurrent = null;
            $("descImage").classList.add("hidden"); $("descImage").removeAttribute("src");
            $("descTopicText").classList.remove("hidden"); $("descTopicText").textContent = t("desc.noTopic");
        }
        renderDescCounters();
    }

    async function editPicTopics() {
        const txt = await openDialog({
            title: t("dlg.picTopicsTitle"), hint: t("dlg.picTopicsHint"),
            value: state.picTopics.join("\n"), multiline: true
        });
        if (txt === null) return;
        const list = txt.split(/\n+/).map((x) => cleanStr(x, 100)).filter(Boolean).slice(0, 300);
        state.picTopics = list.length ? list : [...window.PIC_TOPICS];
        descBag = [];
        save(); renderDesc();
    }

    // ----- speaker draw -----
    function drawSpeaker() {
        if (descBusy) return;
        const c = cls();
        const pool = c.students.filter((s) => s.present && !c.descExcl.includes(s.id));
        if (!pool.length) { toast(t("toast.noSpeaker")); return; }
        initAudio();
        const pick = pool[cryptoInt(pool.length)];
        descBusy = true;
        let n = 0;
        const iv = setInterval(() => {
            $("descSpeakerName").textContent = pool[cryptoInt(pool.length)].name;
            playTick(560);
            if (++n >= (REDUCED_MOTION ? 2 : 12)) {
                clearInterval(iv);
                descBusy = false;
                descSpeaker = pick.name;
                $("descSpeakerName").textContent = pick.name;
                c.descExcl.push(pick.id);
                save(); renderDescCounters();
                playFanfare();
            }
        }, 75);
    }

    function descResetAll() {
        if (tm.iv) { clearInterval(tm.iv); tm.iv = null; }
        tm.phase = "idle"; tm.acc = 0;
        descSpeaker = ""; descCurrent = null;
        const sp = document.getElementById("descSpeakerName"); if (sp) sp.textContent = "—";
        const tx = document.getElementById("descTopicText"); if (tx) { tx.classList.remove("hidden"); tx.textContent = ""; }
        const im = document.getElementById("descImage"); if (im) im.classList.add("hidden");
        const lk = document.getElementById("descSearchLink"); if (lk) lk.classList.add("hidden");
    }

    // ----- rendering -----
    function renderDescCounters() {
        const c = cls();
        const present = presentStudents();
        const called = present.filter((s) => c.descExcl.includes(s.id)).length;
        $("descSpeakerResetBtn").textContent = t("desc.speakerReset", { n: called });
        $("descSpeakerResetBtn").disabled = called === 0;
        $("descSpeakerBtn").disabled = present.length === 0;
        $("descTopicsLeft").textContent = t("desc.topicsLeft", { n: descBag.length || state.picTopics.length });
        const picTotal = descImages.length + Object.values(descSets).reduce((a, x) => a + x.length, 0);
        $("descDrawImageBtn").disabled = picTotal === 0;
        $("descClearImagesBtn").textContent = t("desc.clearImages", { n: picTotal });
        $("descClearImagesBtn").disabled = picTotal === 0;
    }

    function renderDescLog() {
        const c = cls();
        const box = $("descLogList");
        box.innerHTML = "";
        if (!c.descLog.length) {
            const d = document.createElement("div");
            d.className = "col-span-full text-center py-6 bg-slate-950/40 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-xs sm:text-sm";
            d.textContent = t("desc.logEmpty");
            box.appendChild(d);
            return;
        }
        c.descLog.forEach((e) => {
            const row = document.createElement("div");
            row.className = "bg-slate-950/85 border border-slate-800/90 rounded-2xl p-3 flex items-center gap-3 animate-pop-in";
            const dot = document.createElement("span");
            dot.className = "w-3 h-3 rounded-full shrink-0 " + TZ_DOT[zoneOf(e.s)];
            const mid = document.createElement("div");
            mid.className = "min-w-0 flex-1";
            const nm = document.createElement("div");
            nm.className = "text-sm font-bold text-white truncate"; nm.textContent = e.n || "–";
            const tp = document.createElement("div");
            tp.className = "text-xs text-slate-400 truncate"; tp.textContent = e.t || "";
            mid.appendChild(nm); mid.appendChild(tp);
            const tmEl = document.createElement("span");
            tmEl.className = "text-base font-black tabular-nums text-slate-100"; tmEl.textContent = fmtTime(e.s);
            row.appendChild(dot); row.appendChild(mid); row.appendChild(tmEl);
            box.appendChild(row);
        });
    }

    function renderDesc() {
        // topic select
        const sel = $("descTopicSelect");
        const keep = sel.value;
        sel.innerHTML = "";
        const ph = document.createElement("option");
        ph.value = ""; ph.textContent = t("desc.pickTopic");
        sel.appendChild(ph);
        state.picTopics.forEach((tp, i) => {
            const o = document.createElement("option");
            o.value = String(i); o.textContent = tp;
            sel.appendChild(o);
        });
        sel.value = keep;
        if (!descCurrent && !$("descTopicText").textContent) $("descTopicText").textContent = t("desc.noTopic");
        if (!descCurrent) $("descTopicText").textContent = t("desc.noTopic");
        renderDescCounters();
        renderDescLog();
        renderTimerSettings();
        renderTimer();
        if (!$("descPhrases").childElementCount) {
            window.PIC_PHRASES.forEach((g) => {
                const card = document.createElement("div");
                card.className = "bg-slate-900/70 border border-slate-800 rounded-xl p-3";
                const h = document.createElement("div");
                h.className = "text-[11px] font-extrabold uppercase tracking-wider text-amber-300 mb-1.5"; h.textContent = g.h;
                card.appendChild(h);
                g.p.forEach((line) => {
                    const li = document.createElement("div");
                    li.className = "text-xs text-slate-200 leading-relaxed"; li.textContent = line;
                    card.appendChild(li);
                });
                $("descPhrases").appendChild(card);
            });
        }
    }

    async function copyDescLog() {
        const c = cls();
        if (!c.descLog.length) return;
        const lines = [...c.descLog].reverse().map((e) => `${e.n} – ${fmtTime(e.s)}${e.t ? " – " + e.t : ""}`);
        try { await navigator.clipboard.writeText(lines.join("\n")); toast(t("toast.copied")); }
        catch (e) { toast(t("toast.copyFail")); }
    }

    // ==========================================
    // MODE SWITCH
    // ==========================================
    const MODE_ON = {
        wheel: "from-indigo-600 to-purple-600 shadow-indigo-600/30",
        pairs: "from-pink-600 to-indigo-600 shadow-pink-600/30",
        desc: "from-amber-500 to-pink-600 shadow-amber-600/30"
    };

    function setMode(mode) {
        activeMode = mode;
        const base = "px-3.5 py-1.5 rounded-lg font-bold text-xs sm:text-sm transition flex items-center gap-1.5 active:scale-95 ";
        const off = "text-slate-400 hover:text-white";
        const btn = { wheel: $("modeWheelBtn"), pairs: $("modePairsBtn"), desc: $("modeDescBtn") };
        const sec = { wheel: $("sectionWheel"), pairs: $("sectionPairs"), desc: $("sectionDesc") };
        Object.keys(btn).forEach((k) => {
            btn[k].className = base + (k === mode ? `bg-gradient-to-r ${MODE_ON[k]} text-white shadow-md` : off);
            btn[k].setAttribute("aria-selected", String(k === mode));
            sec[k].classList.toggle("hidden", k !== mode);
            sec[k].classList.toggle("flex", k === mode);
        });
        if (mode === "wheel") resizeCanvas();
        if (mode === "desc") { renderDesc(); loadBuiltinPics(); }
    }

    // ==========================================
    // EVENTS
    // ==========================================
    function bind() {
        $("modeWheelBtn").addEventListener("click", () => setMode("wheel"));
        $("modePairsBtn").addEventListener("click", () => setMode("pairs"));
        $("modeDescBtn").addEventListener("click", () => setMode("desc"));

        $("mainSpinBtn").addEventListener("click", startSpin);
        $("centerSpinBtn").addEventListener("click", startSpin);
        wheelCanvas.addEventListener("click", startSpin);

        $("excludeWheelCheckbox").addEventListener("change", (e) => { state.excludeWheel = e.target.checked; save(); updateAll(); });
        $("excludePairsCheckbox").addEventListener("change", (e) => { state.excludePairs = e.target.checked; save(); updateAll(); });
        $("useTopicsCheckbox").addEventListener("change", (e) => {
            state.useTopics = e.target.checked; topicBag = []; save(); updateControls();
            if (state.useTopics && state.topics.length === 0) editTopics();
        });
        $("groupSizeSelect").addEventListener("change", (e) => { state.groupSize = Number(e.target.value); save(); });
        $("editTopicsBtn").addEventListener("click", editTopics);

        $("resetWheelRoundBtn").addEventListener("click", () => {
            if (isSpinning) return;
            cls().wheelExcl = [];
            $("winnerCard").classList.add("hidden");
            save(); updateAll(); toast(t("toast.reset"));
        });
        $("resetPairPoolBtn").addEventListener("click", () => {
            if (isSlotSpinning) return;
            cls().pairExcl = [];
            save(); updateAll(); toast(t("toast.poolReset"));
        });

        $("excludeWinnerBtn").addEventListener("click", () => {
            const c = cls();
            if (lastWinnerId && !c.wheelExcl.includes(lastWinnerId)) c.wheelExcl.push(lastWinnerId);
            state.excludeWheel = true;   // marking only makes sense while exclusion is active
            save(); updateAll(); toast(t("toast.marked"));
            $("winnerCard").classList.add("hidden");
        });
        $("keepWinnerBtn").addEventListener("click", () => {
            const c = cls();
            c.wheelExcl = c.wheelExcl.filter((x) => x !== lastWinnerId);
            save(); updateAll(); toast(t("toast.kept"));
            $("winnerCard").classList.add("hidden");
        });
        $("clearHistoryBtn").addEventListener("click", () => { cls().history = []; save(); renderHistory(); });

        $("spinSlotPairBtn").addEventListener("click", spinPairSlot);
        $("splitAllClassBtn").addEventListener("click", splitClass);
        $("copyPairsBtn").addEventListener("click", copyPairs);
        $("clearPairsHistoryBtn").addEventListener("click", () => {
            cls().pairs = []; save(); renderPairs(); toast(t("toast.listCleared"));
        });

        $("classSelect").addEventListener("change", (e) => {
            if (busy()) { e.target.value = state.activeId; return; }
            state.activeId = e.target.value; resetSessionView(); save(); updateAll();
        });
        $("newClassBtn").addEventListener("click", () => { if (!busy()) newClass(); });
        $("shareClassBtn").addEventListener("click", shareClass);
        $("renameClassBtn").addEventListener("click", renameClass);
        $("deleteClassBtn").addEventListener("click", () => { if (!busy()) deleteClass(); });

        $("toggleEditModeBtn").addEventListener("click", () => {
            editMode = !editMode;
            $("editModeBtnText").textContent = editMode ? t("side.done") : t("side.edit");
            $("toggleEditModeBtn").classList.toggle("bg-indigo-600", editMode);
            $("toggleEditModeBtn").classList.toggle("text-white", editMode);
            $("editModeBanner").classList.toggle("hidden", !editMode);
            renderStudents();
        });

        $("addStudentForm").addEventListener("submit", (e) => {
            e.preventDefault();
            if (busy()) return;
            const name = cleanStr($("newStudentInput").value);
            if (!name) return;
            const r = addNames([name]);
            if (r.hitLimit) toast(t("toast.limit", { n: MAX_STUDENTS }));
            else if (r.added) { playToggle(true); toast(t("toast.added", { name })); }
            $("newStudentInput").value = "";
        });

        $("pasteListBtn").addEventListener("click", async () => {
            if (busy()) return;
            const txt = await openDialog({ title: t("dlg.pasteTitle"), hint: t("dlg.pasteHint"), multiline: true, okLabel: t("dlg.add") });
            if (txt === null) return;
            const r = addNames(txt.split(/[\n\r,;]+/));
            if (r.hitLimit) toast(t("toast.limit", { n: MAX_STUDENTS }));
            else toast(r.added ? t("toast.imported", { n: r.added }) : t("toast.importNone"));
        });

        $("allPresentBtn").addEventListener("click", () => {
            if (busy()) return;
            cls().students.forEach((s) => (s.present = true));
            playToggle(true); save(); updateAll();
        });
        $("allAbsentBtn").addEventListener("click", () => {
            if (busy()) return;
            cls().students.forEach((s) => (s.present = false));
            playToggle(false); save(); updateAll();
        });
        $("searchStudentInput").addEventListener("input", (e) => { searchQuery = e.target.value; renderStudents(); });

        $("exportBtn").addEventListener("click", exportBackup);
        $("importBtn").addEventListener("click", () => $("importFile").click());
        $("importFile").addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) importBackup(f);
            e.target.value = "";
        });

        $("langSelect").addEventListener("change", (e) => {
            state.lang = e.target.value; save(); applyI18n(); updateAll();
        });
        $("soundToggleBtn").addEventListener("click", () => {
            state.sound = !state.sound; save(); applyI18n();
            if (state.sound) playToggle(true);
        });
        $("fullscreenBtn").addEventListener("click", () => {
            if (document.fullscreenElement) document.exitFullscreen();
            else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
        });

        // Space bar = spin (handy with a presentation clicker)
        document.addEventListener("keydown", (e) => {
            if (e.code !== "Space" || e.repeat || $("dlg").open) return;
            const tag = (e.target.tagName || "").toLowerCase();
            if (["input", "textarea", "select", "button"].includes(tag) || e.target.isContentEditable) return;
            if (e.target.getAttribute && e.target.getAttribute("role") === "switch") return;
            e.preventDefault();
            if (activeMode === "wheel") startSpin();
            else if (activeMode === "pairs") spinPairSlot();
            else timerMain();
        });

        // picture description
        $("timerMainBtn").addEventListener("click", timerMain);
        $("timerStopBtn").addEventListener("click", timerStop);
        $("timerResetBtn").addEventListener("click", timerReset);
        $("descDrawTopicBtn").addEventListener("click", drawTopic);
        $("descDrawImageBtn").addEventListener("click", drawImage);
        $("descSpeakerBtn").addEventListener("click", drawSpeaker);
        $("descSpeakerResetBtn").addEventListener("click", () => { cls().descExcl = []; save(); renderDescCounters(); });
        $("descEditTopicsBtn").addEventListener("click", editPicTopics);
        $("descReshuffleBtn").addEventListener("click", () => { descBag = []; renderDescCounters(); });
        $("descTopicSelect").addEventListener("change", (e) => {
            if (e.target.value === "") return;
            const topic = state.picTopics[Number(e.target.value)];
            if (!topic) return;
            descBag = descBag.filter((x) => x !== topic);
            showTopic(topic, true);
        });
        $("descLoadImagesBtn").addEventListener("click", () => $("descImageFile").click());
        $("descImageFile").addEventListener("change", (e) => { if (e.target.files.length) loadImages(e.target.files); e.target.value = ""; });
        $("descClearImagesBtn").addEventListener("click", clearImages);
        $("descLoadFolderBtn").addEventListener("click", () => $("descFolderFile").click());
        $("descFolderFile").addEventListener("change", (e) => { if (e.target.files.length) loadFolder(e.target.files); e.target.value = ""; });
        ["setRedEnd", "setYellowEnd", "setMax", "setPrep"].forEach((id) => $(id).addEventListener("change", readTimeSettings));
        $("descLogCopyBtn").addEventListener("click", copyDescLog);
        $("descLogClearBtn").addEventListener("click", () => { cls().descLog = []; save(); renderDescLog(); toast(t("toast.listCleared")); });

        window.addEventListener("resize", resizeCanvas);
        window.addEventListener("hashchange", handleIncomingShare);
    }

    async function editTopics() {
        const txt = await openDialog({
            title: t("dlg.topicsTitle"), hint: t("dlg.topicsHint"),
            value: state.topics.join("\n"), multiline: true
        });
        if (txt === null) return;
        state.topics = txt.split(/\n+/).map((x) => cleanStr(x, 100)).filter(Boolean).slice(0, 200);
        topicBag = [];
        save();
    }

    // ==========================================
    // INIT
    // ==========================================
    function init() {
        $("buildInfo").textContent = "v13 · " + (REDUCED_MOTION ? "reduced motion (OS) → short spin ~1 s" : "spin 5 s");
        loadState();
        applyI18n();
        bind();
        setMode("wheel");
        updateAll();
        resizeCanvas();
        handleIncomingShare();
        if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
            navigator.serviceWorker.register("sw.js").catch(() => {});
        }
    }

    init();
})();
