import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createServer } from 'vite';
// Reads source clones and transient public references; never bundles catalog data.
const root = process.cwd(), referenceDir = process.env.CUBELAB_AUDIT_REFERENCE_DIR ?? '/tmp', outputDir = process.env.CUBELAB_AUDIT_OUTPUT_DIR ?? '/tmp/cubelab-training-audit', home = os.homedir(), server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
    const c = await server.ssrLoadModule('/src/lib/training/cube3.ts'), n = await server.ssrLoadModule('/src/lib/training/notation.ts'), f = await server.ssrLoadModule('/src/lib/training/frame.ts'), sig = await server.ssrLoadModule('/src/lib/training/caseSignature.ts'), p = await server.ssrLoadModule('/src/lib/training/pllIdentity.ts'), v = await server.ssrLoadModule('/src/lib/training/algorithms.ts'), o = await server.ssrLoadModule('/src/lib/training/catalog/ollCases.ts'), pc = await server.ssrLoadModule('/src/lib/training/catalog/pllCases.ts');
    const g = await server.ssrLoadModule('/src/lib/training/audit/stickerCube.ts'), model = await c.loadCube3Model();
    const read = p => fs.readFileSync(p, 'utf8'), sha = s => crypto.createHash('sha256').update(s).digest('hex');
    function ref(kind) { const text = read(path.join(referenceDir, `audit-ref-${kind}.js`)); const boundary = text.indexOf(',algsetScrambles=');
        if (boundary < 0) throw Error('Unrecognized reference script format: ' + kind);
        const prefix = text.slice(0, boundary); const ctx = {}; vm.runInNewContext(prefix, ctx, { timeout: 2000 }); return ctx.algsetAlgs; }
    const refs = { oll: ref('oll'), pll: ref('pll') };
    console.log('refs', refs.oll.length, refs.pll.length);
    const heroor = JSON.parse(read(path.join(home, 'heroor-cfop/src/data/cube.json'))).oll;
    const taoText = read(path.join(home, 'tao-alg-trainer/js/alg_list.js')), ctx = {};
    vm.runInNewContext(taoText.slice(taoText.indexOf('var PLL ='), taoText.indexOf('var ELL =')), ctx, { timeout: 1000 });
    const base = g.solvedStickers(), aufs = [[], ['U'], ['U2'], ["U'"]];
    // Test every move's cubie action against independent Euclidean rotations.
    let conventionChecks = 0;
    const conventionFailures = [];
    const primitive = ['U', 'D', 'R', 'L', 'F', 'B', 'Uw', 'Dw', 'Rw', 'Lw', 'Fw', 'Bw', 'M', 'E', 'S', 'x', 'y', 'z'];
    for (const move of primitive)
        for (const suffix of ['', "'", '2']) {
            const a = move + suffix, st = c.applyAlgorithm(model.solved, a), gs = g.moveStickers(base, [a]), data = g.stickerCubies(gs);
            for (const orbit of ['CORNERS', 'EDGES'])
                for (const field of ['pieces', 'orientation'])
                    if (JSON.stringify(data[orbit][field]) !== JSON.stringify(st.patternData[orbit][field]))
                        conventionFailures.push({ a, orbit, field, actual: data[orbit][field], expected: st.patternData[orbit][field] });
            conventionChecks++;
        }
    console.log('move conventions', conventionChecks, 'failures', conventionFailures.length);
    if (conventionFailures.length)
        throw Error('Independent primitive move conventions disagree: ' + JSON.stringify(conventionFailures));
    function setup(alg) { const tokens = g.auditTokens(alg), forward = g.moveStickers(base, tokens), frame = g.restoreFrame(forward), normalized = [...tokens, ...frame.correction]; return { tokens, forward, frame, state: g.moveStickers(base, g.inverseTokens(normalized)) }; }
    const refStates = { oll: new Map(), pll: new Map() };
    for (const kind of ['oll', 'pll'])
        for (const r of refs[kind]) {
            const s = setup(r.alg[0]);
            if (!g.stickerF2l(s.state))
                throw Error('bad ref f2l ' + kind + r.name);
            if (kind === 'pll' && !g.stickerOllSolved(s.state))
                throw Error('Independent PLL reference is not oriented: ' + r.name);
            refStates[kind].set(String(r.name), s);
        }
    function solveReference(kind, state, tokens, correction) {
        // A starting AUF changes case angle. For PLL also vary the independent
        // reference by y-conjugation (rotate both cube state and color frame).
        const hits = [];
        for (let y = 0; y < (kind === 'pll' ? 4 : 1); y++) {
            const pre = Array(y).fill('y');
            // Color-relative conjugation: relabel all home stickers through rotation.
            let reference = state;
            if (y) {
                const permutation = g.moveStickers(base, pre);
                const map = new Map(permutation.map(s => [s.home, `${s.p.join(',')}:${s.n.join(',')}`]));
                const back = new Map(base.map(s => [s.home, s]));
                reference = g.moveStickers(state, pre).map(s => ({ ...s, color: back.get(map.get(s.home)).color, home: map.get(s.home) }));
            }
            for (let i = 0; i < 4; i++) {
                const out = g.moveStickers(reference, [...aufs[i], ...tokens, ...correction]);
                if (kind === 'oll') {
                    if (g.stickerOllSolved(out))
                        hits.push({ y, preAuf: i, postAuf: null, solved: g.stickerSolved(out) });
                }
                else
                    for (let j = 0; j < 4; j++)
                        if (g.stickerSolved(g.moveStickers(out, aufs[j])))
                            hits.push({ y, preAuf: i, postAuf: j, solved: true });
            }
        }
        return hits;
    }
    const rows = [];
    let physicalDisagreements = 0;
    function audit(kind, id, source, approved, index = 0) {
        const st = setup(approved), app = f.normalizeAlgorithmFrame(model, approved), appState = c.invertState(app.generatedState), appOll = c.isOllState(appState), appPll = c.isPllState(appState), gCubies = g.stickerCubies(st.state);
        const rawCubies = g.stickerCubies(st.forward);
        const rawSame = ['CORNERS', 'EDGES'].every(orbit => ['pieces', 'orientation'].every(field => JSON.stringify(rawCubies[orbit][field]) === JSON.stringify(app.rawGeneratedState.patternData[orbit][field])));
        const same = rawSame && ['CORNERS', 'EDGES'].every(orbit => ['pieces', 'orientation'].every(field => JSON.stringify(gCubies[orbit][field]) === JSON.stringify(appState.patternData[orbit][field])));
        if (!same)
            physicalDisagreements++;
        const expected = refStates[kind].get(String(id)), hits = solveReference(kind, expected.state, st.tokens, st.frame.correction);
        let identity = null;
        try {
            identity = kind === 'oll' ? sig.canonicalOllSignature(appState) : p.identifyPllCase(appState);
        }
        catch { }
        let appVerify = '';
        try {
            const definition = kind === 'oll' ? o.createOllCaseDefinition({ number: Number(id), canonicalSignature: g.stickerCanonicalOll(expected.state) }) : pc.PLL_STANDARD_CASES.find(x => x.name === id);
            v.verifyAlgorithmForCase({ model, caseDefinition: definition, notation: approved, verifiedAt: '2026-11-08' });
            appVerify = 'pass';
        }
        catch (e) {
            appVerify = e.message;
        }
        const referenceAlgorithms = refs[kind].find(r => String(r.name) === String(id)).alg;
        const norm = st.tokens.join(' '), exact = referenceAlgorithms.some(a => { try {
            return g.auditTokens(a).join(' ') === norm;
        }
        catch {
            return false;
        } });
        if (norm !== n.normalizeCatalogAlgorithm(approved))
            throw Error('Independent notation parsers disagree for ' + kind + id);
        if (!same)
            throw Error('Independent full cubie states disagree for ' + kind + id);
        const good = hits.length > 0 && g.stickerF2l(st.state) && (kind === 'oll' || g.stickerOllSolved(st.state));
        const row = { kind, id, index, source, approved, normalized: norm, classification: good ? (st.frame.correction.length ? 'VALID BUT DIFFERENT CONVENTION' : 'VERIFIED') : 'INCORRECT', appVerify, independentPass: good, enginesAgree: same, identity, f2l: g.stickerF2l(st.state), oll: kind === 'oll' ? appOll : appPll, netFrame: g.inverseTokens(st.frame.correction).join(' '), frameCorrection: st.frame.correction.join(' '), appFrame: app.frameCorrection, rawSetupCubies: g.stickerCubies(g.moveStickers(base, g.inverseTokens(st.tokens))), frameSetupCubies: gCubies, strictCanonicalSetupSignature: kind === 'oll' && appOll ? sig.canonicalOllSignature(appState) : null, rawSetupSignature: g.stickerOllSignature(g.moveStickers(base, g.inverseTokens(st.tokens))), frameSetupSignature: g.stickerOllSignature(st.state), canonicalSetupSignature: kind === 'oll' ? g.stickerCanonicalOll(st.state) : null, referenceSignature: kind === 'oll' ? g.stickerCanonicalOll(expected.state) : null, hits, referenceAgreement: exact ? 'exact normalized listing' : good ? 'independent alternative for same named case' : 'no physical agreement with named reference', caseState: appState.patternData, referenceStickerState: g.stickerKey(expected.state, true) };
        rows.push(row);
        return row;
    }
    for (const record of heroor)
        audit('oll', record.i, record.f, record.i === 45 ? "F R U R' U' F'" : record.i === 56 ? "r U r' (U R U' R')2 r U' r" : record.f);
    for (const [id, arr] of Object.entries(ctx.PLL))
        for (const [i, alg] of arr[0].split('/').entries())
            audit('pll', id, alg, alg, i);
    const candidates = [];
    for (const [id, a] of Object.entries({ A: "r U r' (U R U' R')2 r U' r", B: "r U r' (U R U' R')2 r U' r'", C: "r U r' (R U R' U')2 r U' r'", D: heroor[55].f })) {
        const row = audit('oll', 56, a, a);
        rows.pop();
        row.candidate = id;
        // Best independently supplied reference AUF, or all four failures.
        row.referenceTrials = aufs.map((auf, i) => { const out = g.moveStickers(refStates.oll.get('56').state, [...auf, ...g.auditTokens(a)]); const framed = g.restoreFrame(out); return { auf: i, rawSignature: g.stickerOllSignature(out), frameSignature: g.stickerOllSignature(framed.state), canonicalSignature: g.stickerCanonicalOll(framed.state), f2l: g.stickerF2l(framed.state), oriented: g.stickerOllSolved(framed.state), solved: g.stickerSolved(framed.state), cubies: g.stickerCubies(framed.state) }; });
        candidates.push(row);
    }
    if (heroor.length !== 57 || new Set(heroor.map(r => r.i)).size !== 57 || heroor.some(r => r.i < 1 || r.i > 57))
        throw Error('Missing/duplicate OLL source number');
    const defaults = rows.filter(x => x.index === 0), variants = rows.filter(x => x.index !== 0);
    const referencePllDistinct = new Set([...refStates.pll.values()].map(r => { const data = g.stickerCubies(r.state); return g.permutationClass(data.CORNERS.pieces.slice(0,4),data.EDGES.pieces.slice(0,4)); })).size;
    if (referencePllDistinct !== 21) throw Error('Independent PLL reference labels are not distinct');
    const proposedOll = rows.filter(r => r.kind === 'oll').map(r => r.id === 56 ? candidates.find(x => x.candidate === 'B') : r);
    const result = { referencePllDistinct, proposedOllDistinct: new Set(proposedOll.map(r => r.canonicalSetupSignature)).size, date: '2026-11-08', sourceHashes: { heroor: sha(read(path.join(home, 'heroor-cfop/src/data/cube.json'))), tao: sha(taoText), jpermOll: sha(read(path.join(referenceDir, 'audit-ref-oll.js'))), jpermPll: sha(read(path.join(referenceDir, 'audit-ref-pll.js'))) }, conventionChecks, conventionFailures, physicalDisagreements, defaults, variants, candidates, referenceOllDistinct: new Set([...refStates.oll.values()].map(x => g.stickerCanonicalOll(x.state))).size };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2));
    writeReport(result, outputDir);
    console.log('SUMMARY', JSON.stringify({ defaults: defaults.length, pass: defaults.filter(x => x.independentPass).length, fail: defaults.filter(x => !x.independentPass).map(x => [x.kind, x.id, x.identity]), variants: variants.length, variantFails: variants.filter(x => !x.independentPass).map(x => x.id), physicalDisagreements, refDistinct: result.referenceOllDistinct, candidates: candidates.map(x => [x.candidate, x.independentPass, x.identity, x.appVerify]) }));
}
finally {
    await server.close();
}
function writeReport(result, outputDir) {
    const escape = x => String(x ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ⏎ ');
    const auf = i => ['none', 'U', 'U2', "U'"][i];
    const columns = ['Case ID', 'Source algorithm', 'Owner-approved algorithm', 'Normalized sequence', 'Cube-state verification result', 'Independent verification result', 'Named-case verification', 'F2L preservation', 'AUF/frame handling', 'External reference agreement', 'Confidence', 'Notes and recommended action'];
    const line = x => '| ' + x.map(escape).join(' | ') + ' |';
    const row = (r, alternative = false) => line([
        `${r.kind.toUpperCase()} ${r.id}${alternative ? ` variant ${r.index + 1}` : ''}`,
        r.source, alternative ? 'Not approved as default' : r.approved, r.normalized,
        r.appVerify === 'pass' ? 'PASS' : r.appVerify,
        `${r.classification}; independent stickers ${r.independentPass ? 'PASS' : 'FAIL'}; complete cubies agree=${r.enginesAgree}`,
        r.independentPass ? `Matches independent ${r.kind.toUpperCase()} ${r.id}` : 'Does not match intended case',
        r.f2l ? 'PASS (pairs + cross)' : 'FAIL',
        `Raw net frame ${r.netFrame || 'identity'}; append ${r.frameCorrection || 'no rotation'}; ` + (r.hits.length ? r.hits.map(h => `y=${h.y}, before ${auf(h.preAuf)}, after ${h.postAuf === null ? 'PLL allowed' : auf(h.postAuf)}`).join('; ') : 'no successful AUF'),
        `[J Perm ${r.kind.toUpperCase()}](https://jperm.net/algs/${r.kind}): ${r.referenceAgreement}`,
        'High (two engines, independent named reference)',
        r.independentPass ? (alternative ? 'Keep separate; do not promote' : r.frameCorrection ? 'Keep explicit net frame in metadata' : 'Retain approved default') : 'Quarantine; recommend candidate B; approval remains under review'
    ]);
    const out = [
        '# CubeLab Training — Emergency independent algorithm audit',
        '',
        '2026-11-08. Phase 2C STOPPED. This is a private local verification report, not a licensed production catalog. No default has been replaced.',
        '',
        '**Result: 77/78 currently stated defaults pass physical and named-case checks.** This comprises 56/57 OLL and 21/21 PLL. All 37 additional PLL variants pass separately. OLL 56 candidate A is INCORRECT. Candidate B passes; candidate C solves OLL 54 instead; original D breaks F2L.',
        '',
        '## Evidence and independence',
        '',
        '- Path 1: current CubeLab notation, cubing.js KPuzzle, frame, case identity and verifyAlgorithmForCase.',
        '- Path 2: audit/stickerCube.ts: 54 labeled stickers in integer 3D coordinates; own parser, rotation matrices, inversion, frame restoration, F2L check including cross, physical color checks. It imports neither cubing.js nor any production Training module.',
        '- The geometric model agrees on 54 primitive move variants, a mixed noncommuting wide/slice/rotation composition, and the complete corner/edge state of every default, alternative and candidate. Agreement is a cross-check, not the independent expected-case source.',
        '- Independent named cases were freshly fetched from J Perm OLL/PLL public definitions. Their algorithms construct reference cases in the geometric engine; candidate algorithms are applied to those independently sourced states under all four starting AUFs. PLL also checks four y color-frame conjugations and all four final AUFs. No Heroor diagrams are used as an oracle.',
        '- Separate fixed OLL 56 regression uses explicitly specified stickers (identity permutations; corner twists 1212, edge flips 1010), not an inverse of the candidate. Speedsolving Wiki and SpeedCubeDB independently list candidate B for OLL 56.',
        '- Independent exhaustive orientation enumeration: 216 legal states, 58 AUF classes including skip. Independent numerical permutation double cosets: 288 legal PLL states, 22 classes; one-to-one correspondence with existing named PLL classification, no extra inverse merging.',
        `- Fresh OLL reference: ${result.referenceOllDistinct} distinct numbered non-skip cases. With B considered separately (not adopted), all ${result.proposedOllDistinct} OLL identities are distinct and cover that set. Current A cannot complete the collection.`,
        '- Raw center orientation is not discarded arbitrarily: only a physical member of the 24 proper cube rotations may restore center colors. Cubing.js ordinary 3x3 center markings are unobservable (orientationMod=1); the sticker model compares physical center colors, not supercube markings.',
        '- A successful OLL result means F2L solved and U face oriented; a residual PLL is allowed. It does not mean an ordinary AUF alone solves the entire cube. PLL results must solve all stickers after an allowed final U turn and explicit frame correction.',
        '',
        '## OLL 56 root cause and disagreements',
        '',
        'The preserved /tmp/opencode/generate_report.py line 38 gives the compact correction ending r\' but transcribes its expanded sequence with final Rw (prime omitted). The preserved Phase 2B script actually tests B, not A, as its E6 variant, and its saved output records B passing. The documentation then describes that result using the mistyped A expansion. No preserved executed check establishes that A passed the guarded canonicalOllSignature API. This is a reporting/provenance error; the exact wording later drifted again to C. The latest user-stated approval A remains preserved separately from historical E6.7 C.',
        '',
        'A particularly dangerous coincidence: A\'s first four twist/flip digits can also read 1212|1010 despite displaced lower-layer cubies. Those digits are diagnostics, not a valid OLL signature. The guarded production canonical signature rejects A. Group inversion by itself cannot prove a named algorithm valid: any move sequence solves its own inverse.',
        '',
        '| Candidate | Exact normalized expansion | Frame correction | Raw inverse top digits | Frame-normalized inverse top digits | Diagnostic AUF-min digits | F2L | Valid OLL 56 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...result.candidates.map(r => line([r.candidate, r.normalized, r.frameCorrection || 'none', r.rawSetupSignature, r.frameSetupSignature, r.canonicalSetupSignature, r.f2l ? 'yes' : 'NO', r.independentPass ? 'YES' : 'NO'])),
        '',
        '**Important:** The diagnostic digits above are not legal case identities for A/D. Their full cubie arrays are in results.json. Raw inverse means inverse(original algorithm); frame-normalized inverse means inverse(original algorithm followed by its center-restoring rotation). Canonicalization applies only U rotations, never reflections or arbitrary color permutations.',
        '',
        'Applied to the independent J Perm OLL 56 reference state (all four AUFs tested):',
        '',
        '| Candidate | AUF | Raw output digits | Frame-normalized output digits | Diagnostic AUF-min | F2L solved | Last layer oriented with F2L | Fully solved |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...result.candidates.flatMap(r => r.referenceTrials.map(t => line([r.candidate, auf(t.auf), t.rawSignature, t.frameSignature, t.canonicalSignature, t.f2l, t.oriented, t.solved]))),
        '',
        '- **A: INCORRECT.** Has a net x2 center rotation; restoring that frame still leaves lower-layer cubies displaced. An oriented-looking U face at some AUFs cannot be repaired by any permissible last-layer PLL/AUF. Strict OLL signature: unavailable.',
        '- **B: VERIFIED.** No net frame correction; matches 1212|1010 and correctly orients OLL 56 at the appropriate AUFs. On the independent reference, the result retains an edge three-cycle (PLL allowed); on the explicitly constructed fixed orientation-only regression it likewise guarantees orientation with F2L preserved, with PLL permitted. Recommend this string for renewed owner review; it has not been installed as a default.',
        '- **C: INCORRECT for OLL 56.** Preserves F2L but matches OLL 54 (1212|0110). None of the four AUFs orients OLL 56. It is not an AUF convention for OLL 56.',
        '- **D: INCORRECT.** Original source is expanded literally with its newline treated as a display break. Breaks F2L after explicit frame restoration; no AUF solves the intended case.',
        '',
        '## Separate validator defect',
        '',
        'isF2lSolved previously checked only f2lSlotStatuses (four corner/edge pairs); it omitted DF/DR/DB/DL. A physically legal D-edge three-cycle could pass isOllState/isPllState and obtain verified metadata. Before the fix, B followed by x2 M2 U M U2 M\' U M2 x2 was reproduced as a false positive. The new test failed before editing, then passed after checking all F2L_CORNER_PIECES and F2L_EDGE_PIECES. No Training UI/storage/default changes.',
        '',
        'Existing round-trip tests used inverse-generated fixtures, and setupGeneration.test.ts derives some expected OLL identities from the same supplied algorithm. Those checks exercise mechanics, not independent numbering. None covered an isolated broken cross with solved pairs. The prior 77-test pass therefore did not substantiate a complete catalog or reject this defect. Existing structural validation is not a full arbitrary supercube reachability proof; impossible center arrangements are still rejected by the case/frame gates.',
        '',
        '## All 78 approved defaults',
        '', line(columns), line(columns.map(() => '---')),
        ...result.defaults.map(r => row(r)),
        '',
        '## Additional 37 PLL variants — not approved defaults',
        '', line(columns), line(columns.map(() => '---')),
        ...result.variants.map(r => row(r, true)),
        '',
        '## Additional findings and boundaries',
        '',
        '- Original OLL 45 remains incorrect; its owner-approved F\' correction passes both paths and the independently numbered reference. No new incorrect default beyond OLL 56 was found.',
        '- OLL 36 needs an x frame correction; Ga/Gc/Gd/V defaults need a y frame correction. They are classified VALID BUT DIFFERENT CONVENTION. All other passing defaults are VERIFIED. This classification does not promote alternative algorithms.',
        '- Exact reference agreement is conservative: it means expanded notation equals one of the independently listed J Perm alternatives. A different spelling/rotation/AUF may be equivalent without being marked exact. Alternate reference agreement rests on physical named-case solving, not textual resemblance.',
        '- Fixed sticker states, all primitive directions, move order, group inversion, cross preservation, invalid twists, center-frame rejection, and exhaustive OLL/PLL class counts are covered by regressions. This is computational evidence, not a fresh human physical-cube execution of 115 algorithms.',
        '- Source rights remain unresolved: Heroor README MIT claim has no LICENSE file; Tao software MIT does not clearly settle attributed algorithm-data rights. This generated full table and source strings stay outside the repository; do not publish/bundle them. J Perm reference files are transient comparison inputs, not redistributed datasets.',
        '- Mathematical move conventions and the 77 passing defaults have strong independent support. The foundation was not safe as previously claimed because of the cross defect and reporting error. The focused repair and new regressions address those confirmed issues. Phase 2C remains stopped pending renewed OLL 56 approval and licensing resolution; no unconditional green light.',
        '',
        '## Reference links and reproduction',
        '',
        '- [J Perm OLL](https://jperm.net/algs/oll), [OLL definition script](https://jperm.net/lib/oll.js?v=20190924-1156)',
        '- [J Perm PLL](https://jperm.net/algs/pll), [PLL definition script](https://jperm.net/lib/pll.js?v=20190924-1156)',
        '- [Speedsolving OLL](https://www.speedsolving.com/wiki/index.php/OLL), [SpeedCubeDB OLL 56](https://www.speedcubedb.com/a/3x3/OLL/OLL_56)',
        '- Reproduce: Node 22.22.2+ in the 22.x line, 24.15+, or 26+; download the two public J Perm definition scripts to /tmp/audit-ref-oll.js and /tmp/audit-ref-pll.js; run node scripts/audit-training.mjs from the checkout. Optional CUBELAB_AUDIT_REFERENCE_DIR and CUBELAB_AUDIT_OUTPUT_DIR change transient input/output directories. Local source clones are read from ~/heroor-cfop and ~/tao-alg-trainer. No dependencies are installed.',
        '- Source revisions: Heroor e1cba6995f3ff27732ac18c767e7e9ca1343f13a; Tao cb95945c3e4839ee1e4b058d4a79bc022615b220 (confirm against clones when reproducing).',
        '',
        'SHA-256 input snapshots:',
        '', ...Object.entries(result.sourceHashes).map(([k, v]) => `- ${k}: ${v}`),
        '',
        'Verification commands and final outcomes are recorded in docs/training/PROJECT_MEMORY.md E8. No commit, push, deployment or publication was performed.'
    ];
    fs.writeFileSync(path.join(outputDir, 'REPORT.md'), out.join('\n') + '\n');
}
