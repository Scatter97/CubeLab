/** Audit-only geometric oracle. No cubing.js or production Training imports.
 * Right-handed coordinates: R=+x, U=+y, F=+z. Clockwise is -90 degrees
 * viewed from outside the turning face. Each sticker retains its home identity.
 */
type V = readonly [
    number,
    number,
    number
];
export interface Sticker {
    readonly home: string;
    readonly color: string;
    readonly p: V;
    readonly n: V;
}
const faces: Record<string, V> = { R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1] };
const key = (v: V) => v.join(',');
export const cornerNames = ['UFR', 'UBR', 'UBL', 'UFL', 'DFR', 'DFL', 'DBL', 'DBR'];
export const edgeNames = ['UF', 'UR', 'UB', 'UL', 'DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BR', 'BL'];
const cornerFaces = ['URF', 'UBR', 'ULB', 'UFL', 'DFR', 'DLF', 'DBL', 'DRB'];
const position = (name: string): V => [...name].reduce<V>((a, f) => a.map((x, i) => x + faces[f]![i]!) as unknown as V, [0, 0, 0]);
export function solvedStickers(): Sticker[] {
    const out: Sticker[] = [];
    for (const [color, n] of Object.entries(faces)) {
        const axis = n.findIndex(x => x !== 0);
        for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++) {
                const p = [...n];
                p[(axis + 1) % 3] = a;
                p[(axis + 2) % 3] = b;
                out.push({ color, p: p as unknown as V, n, home: `${key(p as unknown as V)}:${key(n)}` });
            }
    }
    return out;
}
/** Separate recursive scanner; never invokes the application notation parser. */
export function auditTokens(input: string): string[] {
    let i = 0;
    const seq = (nested: boolean): string[] => {
        const out: string[] = [];
        while (i < input.length) {
            if (/\s/.test(input[i]!)) {
                i++;
                continue;
            }
            if (input[i] === ')') {
                if (!nested)
                    throw Error('Unmatched group');
                i++;
                return out;
            }
            if (input[i] === '(') {
                i++;
                const group = seq(true);
                const digits = /^\d+/.exec(input.slice(i))?.[0] ?? '';
                i += digits.length;
                const count = digits ? Number(digits) : 1;
                if (!group.length || count < 1 || count > 9)
                    throw Error('Invalid repeat');
                for (let j = 0; j < count; j++)
                    out.push(...group);
            }
            else {
                const match = /^(?:[URFDLB]w?|[urfdlbMESxyz])(?:2'|'2|2|')?/.exec(input.slice(i));
                if (!match)
                    throw Error(`Invalid notation at ${i}`);
                i += match[0].length;
                let t = match[0].replace(/'2|2'/g, '2');
                if (/^[urfdlb]/.test(t))
                    t = t[0]!.toUpperCase() + 'w' + t.slice(1);
                out.push(t);
            }
            if (out.length > 512)
                throw Error('Too many moves');
        }
        if (nested)
            throw Error('Unclosed group');
        return out;
    };
    const result = seq(false);
    if (!result.length)
        throw Error('Empty sequence');
    return result;
}
export function inverseTokens(tokens: readonly string[]): string[] {
    return [...tokens].reverse().map(t => t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : t + "'");
}
function rotate(v: V, axis: number, turns: number): V {
    const out = [...v];
    for (let t = 0; t < (turns % 4 + 4) % 4; t++) {
        const a = (axis + 1) % 3, b = (axis + 2) % 3, x = out[a]!;
        out[a] = -out[b]!;
        out[b] = x;
    }
    return out as unknown as V;
}
export function moveStickers(state: readonly Sticker[], tokens: readonly string[]): Sticker[] {
    let out = [...state];
    for (const token of tokens) {
        const base = token.replace(/['2]/g, '');
        const suffix = token.slice(base.length);
        let axis: number, sign: number, layer: (x: number) => boolean;
        if ('xyz'.includes(base)) {
            axis = 'xyz'.indexOf(base);
            sign = -1;
            layer = () => true;
        }
        else if ('MES'.includes(base)) {
            axis = { M: 0, E: 1, S: 2 }[base]!;
            sign = base === 'S' ? -1 : 1;
            layer = x => x === 0;
        }
        else {
            const n = faces[base[0]!]!;
            axis = n.findIndex(x => x !== 0);
            const side = n[axis]!;
            sign = -side;
            layer = base.endsWith('w') ? x => x * side >= 0 : x => x === side;
        }
        const turns = sign * (suffix === '2' ? 2 : suffix === "'" ? -1 : 1);
        out = out.map(s => layer(s.p[axis]!) ? { ...s, p: rotate(s.p, axis, turns), n: rotate(s.n, axis, turns) } : s);
    }
    return out;
}
export function stickerKey(state: readonly Sticker[], colorsOnly = false): string {
    return state.map(s => `${key(s.p)}:${key(s.n)}=${colorsOnly ? s.color : s.home}`).sort().join(';');
}
export function centersHome(state: readonly Sticker[]): boolean {
    return state.filter(s => s.p.filter(x => x !== 0).length === 1).every(s => key(s.n) === key(faces[s.color]!));
}
export function geometricRotations(): string[][] {
    const queue: string[][] = [[]], seen = new Set<string>(), out: string[][] = [];
    while (queue.length) {
        const a = queue.shift()!, st = moveStickers(solvedStickers(), a), k = st.filter(s => s.p.filter(x => x !== 0).length === 1).map(s => key(s.p)).join(';');
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(a);
        for (const m of ['x', 'y', 'z'])
            queue.push([...a, m]);
    }
    return out;
}
const rotations = geometricRotations();
export function restoreFrame(state: readonly Sticker[]): {
    state: Sticker[];
    correction: string[];
} {
    const matches = rotations.map(correction => ({ state: moveStickers(state, correction), correction })).filter(x => centersHome(x.state));
    if (matches.length !== 1)
        throw Error('Invalid center frame');
    return matches[0]!;
}
export function stickerF2l(state: readonly Sticker[]): boolean {
    return centersHome(state) && state.filter(s => s.p[1] < 1).every(s => key(s.n) === key(faces[s.color]!));
}
export function stickerOllSolved(state: readonly Sticker[]): boolean {
    return stickerF2l(state) && state.filter(s => s.n[1] === 1).every(s => s.color === 'U');
}
export function stickerSolved(state: readonly Sticker[]): boolean {
    return centersHome(state) && state.every(s => key(s.n) === key(faces[s.color]!));
}
export function stickerCubies(state: readonly Sticker[]) {
    const orbit = (names: string[], order: string[]) => {
        const pieces: number[] = [], orientation: number[] = [];
        for (let i = 0; i < names.length; i++) {
            const at = state.filter(s => key(s.p) === key(position(names[i]!)));
            const id = names.findIndex(name => [...name].sort().join('') === at.map(s => s.color).sort().join(''));
            if (id < 0)
                throw Error('Invalid sticker cubie');
            pieces.push(id);
            const primary = order[id]![0]!, sticker = at.find(s => s.color === primary)!;
            orientation.push([...order[i]!].findIndex(f => key(faces[f]!) === key(sticker.n)));
        }
        return { pieces, orientation };
    };
    return { CORNERS: orbit(cornerNames, cornerFaces), EDGES: orbit(edgeNames, edgeNames) };
}
export function stickerOllSignature(state: readonly Sticker[]): string {
    const c = stickerCubies(state);
    return c.CORNERS.orientation.slice(0, 4).join('') + '|' + c.EDGES.orientation.slice(0, 4).join('');
}
export function stickerCanonicalOll(state: readonly Sticker[]): string {
    return [[], ['U'], ['U2'], ["U'"]].map(a => stickerOllSignature(moveStickers(state, a))).sort()[0]!;
}
/** Construct a case directly from independently specified sticker orientations.
 * No algorithm inversion; identity piece permutation and centers remain fixed.
 */
export function orientedTop(corners: readonly number[], edges: readonly number[]): Sticker[] {
    if (corners.length !== 4 || edges.length !== 4 || corners.some(x => !Number.isInteger(x) || x < 0 || x > 2) || edges.some(x => !Number.isInteger(x) || x < 0 || x > 1) || corners.reduce((a, b) => a + b, 0) % 3 || edges.reduce((a, b) => a + b, 0) % 2)
        throw Error('Illegal top orientation');
    return solvedStickers().map(s => {
        for (const [names, orders, values] of [[cornerNames, cornerFaces, corners], [edgeNames, edgeNames, edges]] as const) {
            const i = names.slice(0, 4).findIndex(name => key(position(name)) === key(s.p));
            if (i >= 0) {
                const order = orders[i]!, j = order.indexOf(s.color);
                return { ...s, n: faces[order[(j + values[i]!) % order.length]!]! };
            }
        }
        return s;
    });
}
/** Numeric pre/post U orbits, independent of KPuzzle transformations/names. */
export function permutationClass(corners: readonly number[], edges: readonly number[]): string {
    const keys: string[] = [];
    for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++)
            keys.push([corners, edges].map(p => p.map((_, i) => (p[(i + a) % 4]! + b) % 4).join('')).join('|'));
    return keys.sort()[0]!;
}
