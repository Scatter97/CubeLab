// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { KPattern } from 'cubing/kpuzzle';
import { applyAlgorithm, invertState, isF2lSolved, isOllState, loadCube3Model, type Cube3Model } from '../cube3';
import { normalizeAlgorithmFrame } from '../frame';
import { normalizeCatalogAlgorithm, invertAlgorithm } from '../notation';
import { canonicalOllSignature } from '../caseSignature';
import { verifyAlgorithmForCase } from '../algorithms';
import { createOllCaseDefinition } from '../catalog/ollCases';
import { identifyPllCase } from '../pllIdentity';
import { auditTokens, inverseTokens, moveStickers, solvedStickers, stickerCubies, stickerKey, stickerF2l, stickerOllSolved, stickerCanonicalOll, orientedTop, restoreFrame, geometricRotations, permutationClass } from './stickerCube';
let model: Cube3Model;
beforeAll(async () => { model = await loadCube3Model(); });
const A = "r U r' (U R U' R')2 r U' r";
const B = "r U r' (U R U' R')2 r U' r'";
const C = "r U r' (R U R' U')2 r U' r'";
const D = "(rUr')(URU'R')2\n(r'U'r')";
// Numbered reference: Speedsolving OLL 56, independently checked against
// J Perm's OLL 56. UFR,UBR,UBL,UFL twists; UF,UR,UB,UL flips.
const definition = createOllCaseDefinition({ number: 56, canonicalSignature: '1212|1010' });
const fixed = () => orientedTop([1, 2, 1, 2], [1, 0, 1, 0]);
describe('emergency independent Training audit', () => {
    it('agrees on all 54 primitive moves including wide/slice/rotation directions', () => {
        for (const base of ['U', 'D', 'L', 'R', 'F', 'B', 'Uw', 'Dw', 'Lw', 'Rw', 'Fw', 'Bw', 'M', 'E', 'S', 'x', 'y', 'z'])
            for (const suffix of ['', "'", '2']) {
                const token = base + suffix, actual = stickerCubies(moveStickers(solvedStickers(), [token])), expected = applyAlgorithm(model.solved, token).patternData;
                for (const orbit of ['CORNERS', 'EDGES'] as const) {
                    expect(actual[orbit].pieces, token).toEqual(expected[orbit]!.pieces);
                    expect(actual[orbit].orientation, token).toEqual(expected[orbit]!.orientation);
                }
            }
    });
    it('agrees on noncommuting move order, inverse and 24 physical frames', () => {
        expect(geometricRotations()).toHaveLength(24);
        const tokens = auditTokens("(r U M' E S2 x y' z Fw' L D2)2");
        expect(tokens.join(' ')).toBe(normalizeCatalogAlgorithm("(r U M' E S2 x y' z Fw' L D2)2"));
        const actual = stickerCubies(moveStickers(solvedStickers(), tokens)), expected = applyAlgorithm(model.solved, tokens.join(' ')).patternData;
        for (const orbit of ['CORNERS', 'EDGES'] as const) {
            expect(actual[orbit].pieces).toEqual(expected[orbit]!.pieces);
            expect(actual[orbit].orientation).toEqual(expected[orbit]!.orientation);
        }
        expect(inverseTokens(tokens).join(' ')).toBe(invertAlgorithm(tokens.join(' ')));
        expect(stickerKey(moveStickers(solvedStickers(), [...tokens, ...inverseTokens(tokens)]))).toBe(stickerKey(solvedStickers()));
        expect(stickerKey(moveStickers(solvedStickers(), ['R', 'U']))).not.toBe(stickerKey(moveStickers(solvedStickers(), ['U', 'R'])));
        for (const rotation of geometricRotations())
            expect(stickerKey(restoreFrame(moveStickers(fixed(), rotation)).state)).toBe(stickerKey(fixed()));
    });
    it('expands all four conflicting strings exactly and preserves the final prime', () => {
        expect(normalizeCatalogAlgorithm(B)).toBe("Rw U Rw' U R U' R' U R U' R' Rw U' Rw'");
        for (const a of [A, B, C, D])
            expect(auditTokens(a).join(' ')).toBe(normalizeCatalogAlgorithm(a));
        expect(auditTokens(A).at(-1)).toBe('Rw');
        expect(auditTokens(B).at(-1)).toBe("Rw'");
    });
    it('solves an explicit OLL 56 sticker state only with B', () => {
        expect(stickerCanonicalOll(fixed())).toBe('1212|1010');
        for (const [a, pass] of [[A, false], [B, true], [C, false], [D, false]] as const) {
            const trials = ['', 'U', 'U2', "U'"].map(auf => {
                const tokens = [...(auf ? [auf] : []), ...auditTokens(a)];
                return restoreFrame(moveStickers(fixed(), tokens)).state;
            });
            expect(trials.some(stickerOllSolved), a).toBe(pass);
            if (a === A || a === D)
                expect(trials.some(stickerF2l), a).toBe(false);
        }
    });
    it('rejects A/C/D and accepts B against a fixed external case identity', () => {
        for (const notation of [A, C, D])
            expect(() => verifyAlgorithmForCase({ model, caseDefinition: definition, notation, verifiedAt: '2026-11-08' })).toThrow();
        expect(verifyAlgorithmForCase({ model, caseDefinition: definition, notation: B, verifiedAt: '2026-11-08' }).identity.canonicalSignature).toBe('1212|1010');
        const wrong = invertState(normalizeAlgorithmFrame(model, C).generatedState);
        expect(canonicalOllSignature(wrong)).toBe('1212|0110');
        const broken = invertState(normalizeAlgorithmFrame(model, A).generatedState);
        expect(isF2lSolved(broken)).toBe(false);
        expect(() => canonicalOllSignature(broken)).toThrow();
    });
    it('retains the approved OLL 45 correction and rejects the original wide turn', () => {
        const oll45 = createOllCaseDefinition({ number: 45, canonicalSignature: '0012|1010' });
        expect(() => verifyAlgorithmForCase({ model, caseDefinition: oll45, notation: "F(RUR'U')f'", verifiedAt: '2026-11-08' })).toThrow();
        expect(verifyAlgorithmForCase({ model, caseDefinition: oll45, notation: "F R U R' U' F'", verifiedAt: '2026-11-08' }).identity.canonicalSignature).toBe('0012|1010');
        const reference = orientedTop([0, 0, 1, 2], [1, 0, 1, 0]);
        for (const [notation, passes] of [["F(RUR'U')f'", false], ["F R U R' U' F'", true]] as const) {
            expect(['', 'U', 'U2', "U'"].some(auf => stickerOllSolved(restoreFrame(moveStickers(reference, [...(auf ? [auf] : []), ...auditTokens(notation)])).state))).toBe(passes);
        }
    });
    it('rejects a legal bottom-cross 3-cycle even with all four F2L slots solved', () => {
        // Conjugating a U edge cycle into D leaves every F2L pair home.
        const notation = B + " x2 M2 U M U2 M' U M2 x2";
        const state = invertState(normalizeAlgorithmFrame(model, notation).generatedState);
        expect(stickerF2l(restoreFrame(moveStickers(fixed(), auditTokens(notation))).state)).toBe(false);
        expect(isF2lSolved(state)).toBe(false);
        expect(isOllState(state)).toBe(false);
        expect(() => verifyAlgorithmForCase({ model, caseDefinition: definition, notation, verifiedAt: '2026-11-08' })).toThrow();
    });
    it('rejects impossible cubies and does not bless a structurally valid impossible center frame', () => {
        const data = { cornerPieces: [0, 1, 2, 3, 4, 5, 6, 7], cornerOrientations: [1, 0, 0, 0, 0, 0, 0, 0], edgePieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], edgeOrientations: Array<number>(12).fill(0) };
        expect(() => model.createState(data)).toThrow();
        expect(() => orientedTop([1, 0, 0, 0], [0, 0, 0, 0])).toThrow();
        const bad = structuredClone(model.solved.patternData);
        bad.CENTERS!.pieces = [2, 1, 0, 5, 4, 3];
        const impossible = new KPattern(model.kpuzzle, bad);
        expect(isOllState(impossible)).toBe(false);
        expect(() => identifyPllCase(impossible)).toThrow();
    });
    it('keeps exactly 22 independent PLL classes across every legal permutation', () => {
        const perms = (a: number[]): number[][] => a.length ? a.flatMap((n, i) => perms(a.filter((_, j) => i !== j)).map(p => [n, ...p])) : [[]];
        const parity = (a: number[]) => a.reduce((n, x, i) => n + a.slice(i + 1).filter(y => x > y).length, 0) % 2;
        const map = new Map<string, Set<string>>(), inverse = new Map<string, Set<string>>();
        let count = 0;
        for (const corners of perms([0, 1, 2, 3]))
            for (const edges of perms([0, 1, 2, 3]))
                if (parity(corners) === parity(edges)) {
                    const state = model.createState({ cornerPieces: [...corners, 4, 5, 6, 7], cornerOrientations: Array<number>(8).fill(0), edgePieces: [...edges, 4, 5, 6, 7, 8, 9, 10, 11], edgeOrientations: Array<number>(12).fill(0) });
                    const independent = permutationClass(corners, edges), named = identifyPllCase(state);
                    map.set(independent, new Set([...(map.get(independent) ?? []), named]));
                    inverse.set(named, new Set([...(inverse.get(named) ?? []), independent]));
                    count++;
                }
        expect(count).toBe(288);
        expect(map.size).toBe(22);
        expect(inverse.size).toBe(22);
        for (const set of [...map.values(), ...inverse.values()])
            expect(set.size).toBe(1);
    });
    it('enumerates all 216 legal OLL orientations and 57 non-skip AUF classes independently', () => {
        const classes = new Set<string>();
        let count = 0;
        for (let a = 0; a < 3; a++)
            for (let b = 0; b < 3; b++)
                for (let c = 0; c < 3; c++)
                    for (let e = 0; e < 2; e++)
                        for (let f = 0; f < 2; f++)
                            for (let g = 0; g < 2; g++) {
                                classes.add(stickerCanonicalOll(orientedTop([a, b, c, (6 - a - b - c) % 3], [e, f, g, (e + f + g) % 2])));
                                count++;
                            }
        expect(count).toBe(216);
        expect(classes.size).toBe(58);
        classes.delete('0000|0000');
        expect(classes.size).toBe(57);
    });
});
