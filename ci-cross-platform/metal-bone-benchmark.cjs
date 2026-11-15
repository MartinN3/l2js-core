'use strict';

const fs = require('node:fs');
const parser = require('@babel/parser');
const babel = require('@babel/core');

function getMethod(source, name) {
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] });
    for (const statement of ast.program.body) {
        if (statement.type !== 'ExportNamedDeclaration' || !statement.declaration || statement.declaration.type !== 'ClassDeclaration' || statement.declaration.id.name !== 'LocalSpaceSkeleton') continue;
        const method = statement.declaration.body.body.find(item => item.type === 'ClassMethod' && item.key.name === name);
        if (!method) throw new Error(`Could not find ${name} in LocalSpaceSkeleton`);
        return source.slice(method.start, method.end);
    }
    throw new Error('Could not find LocalSpaceSkeleton');
}

function compile(source, label) {
    const classSource = `class ${label} {\n${getMethod(source, 'claimBones')}\n${getMethod(source, 'updateAttachmentVisibility')}\n}`;
    const compiled = babel.transformSync(classSource, { filename: `${label}.ts`, configFile: false, babelrc: false, presets: [require.resolve('@babel/preset-typescript')] }).code;
    return new Function('Matrix4', 'frozenUpdateMatrixWorld', `${compiled}\nreturn ${label};`)(class {}, function frozenUpdateMatrixWorld() {});
}

function createInstance(Probe, count, loose) {
    const mesh = { children: [] }, externalRoot = { children: [] };
    const bones = Array.from({ length: count }, () => ({ children: [], visible: true }));
    let parent = loose ? externalRoot : mesh;
    for (const bone of bones) { bone.parent = parent; parent.children.push(bone); parent = bone; }
    return Object.assign(Object.create(Probe.prototype), {
        bones, mesh, parents: null, locals: null, attachments: null, ownsBones: false
    });
}

function reset(instance) {
    instance.parents = null;
    instance.locals = null;
    instance.attachments = null;
    instance.ownsBones = false;
}

function verify(Probe, label, count, loose, expectedParents) {
    const instance = createInstance(Probe, count, loose);
    instance.claimBones();
    const actual = Array.from(instance.parents);
    if (JSON.stringify(actual) !== JSON.stringify(expectedParents))
        throw new Error(`${label} ${loose ? 'loose' : 'owned'} ${count}: parents ${actual} != ${expectedParents}`);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}
function p95(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * .95)];
}

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) throw new Error('Usage: node cross-platform-claim-benchmark.cjs baseline/local-space-skeleton.ts candidate/local-space-skeleton.ts');
const Baseline = compile(fs.readFileSync(baselinePath, 'utf8'), 'Baseline');
const Candidate = compile(fs.readFileSync(candidatePath, 'utf8'), 'Candidate');

for (const count of [2, 4, 8, 16, 32, 64, 128]) {
    const owned = Array.from({ length: count }, (_, i) => i === 0 ? -1 : i - 1);
    verify(Baseline, 'baseline', count, false, owned);
    verify(Candidate, 'candidate', count, false, owned);
    verify(Candidate, 'candidate', count, true, Array(count).fill(-1));
}
verify(Baseline, 'baseline', 8, true, Array(8).fill(0));

function createBase(count, loose) { return createInstance(Baseline, count, loose); }
function createCandidate(count, loose) { return createInstance(Candidate, count, loose); }
function runBaseline(instance, calls) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) { reset(instance); instance.claimBones(); }
    return (performance.now() - start) * 1e6 / calls;
}
function runCandidate(instance, calls) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) { reset(instance); instance.claimBones(); }
    return (performance.now() - start) * 1e6 / calls;
}
function runFreshBaseline(count, loose, calls) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) createBase(count, loose).claimBones();
    return (performance.now() - start) * 1e6 / calls;
}
function runFreshCandidate(count, loose, calls) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) createCandidate(count, loose).claimBones();
    return (performance.now() - start) * 1e6 / calls;
}

const rounds = Number(process.env.BENCH_ROUNDS || 41);
console.log(JSON.stringify({ kind: 'environment', runtime: process.version, platform: process.platform, arch: process.arch, rounds, mode: 'extracted production claimBones + updateAttachmentVisibility; CPU only; Matrix4 stub; no rendering/GPU' }));

for (const scenario of [
    ...[32, 64, 128, 256, 512].map(bones => ({ bones, loose: false, calls: 1000 })),
    ...[2, 4, 8, 16, 32, 64, 128].map(bones => ({ bones, loose: true, calls: 2000 }))
]) {
    const baseline = createBase(scenario.bones, scenario.loose);
    const candidate = createCandidate(scenario.bones, scenario.loose);
    for (let i = 0; i < 15; i++) { runBaseline(baseline, scenario.calls); runCandidate(candidate, scenario.calls); }
    const baseSamples = [], candidateSamples = [];
    for (let round = 0; round < rounds; round++) {
        if (global.gc) global.gc();
        const baseFirst = round % 2 === 0;
        const first = baseFirst ? runBaseline(baseline, scenario.calls) : runCandidate(candidate, scenario.calls);
        const second = baseFirst ? runCandidate(candidate, scenario.calls) : runBaseline(baseline, scenario.calls);
        if (baseFirst) { baseSamples.push(first); candidateSamples.push(second); }
        else { candidateSamples.push(first); baseSamples.push(second); }
    }
    console.log(JSON.stringify({ kind: 'claimBones', bones: scenario.bones, skeleton: scenario.loose ? 'loose' : 'owned', callsPerRound: scenario.calls,
        baselineNs: { median: median(baseSamples), p95: p95(baseSamples) }, candidateNs: { median: median(candidateSamples), p95: p95(candidateSamples) },
        medianDeltaPercent: (median(candidateSamples) / median(baseSamples) - 1) * 100 }));
}

for (const scenario of [
    { bones: 64, loose: false, calls: 25 }, { bones: 128, loose: false, calls: 25 }, { bones: 256, loose: false, calls: 25 },
    { bones: 2, loose: true, calls: 100 }, { bones: 8, loose: true, calls: 100 }, { bones: 32, loose: true, calls: 100 }, { bones: 128, loose: true, calls: 100 }
]) {
    for (let i = 0; i < 3; i++) { runFreshBaseline(scenario.bones, scenario.loose, scenario.calls); runFreshCandidate(scenario.bones, scenario.loose, scenario.calls); }
    const baseSamples = [], candidateSamples = [];
    for (let round = 0; round < 31; round++) {
        if (global.gc) global.gc();
        const baseFirst = round % 2 === 0;
        const first = baseFirst ? runFreshBaseline(scenario.bones, scenario.loose, scenario.calls) : runFreshCandidate(scenario.bones, scenario.loose, scenario.calls);
        const second = baseFirst ? runFreshCandidate(scenario.bones, scenario.loose, scenario.calls) : runFreshBaseline(scenario.bones, scenario.loose, scenario.calls);
        if (baseFirst) { baseSamples.push(first); candidateSamples.push(second); }
        else { candidateSamples.push(first); baseSamples.push(second); }
    }
    console.log(JSON.stringify({ kind: 'freshSkeleton', bones: scenario.bones, skeleton: scenario.loose ? 'loose' : 'owned', callsPerRound: scenario.calls,
        baselineNs: { median: median(baseSamples), p95: p95(baseSamples) }, candidateNs: { median: median(candidateSamples), p95: p95(candidateSamples) },
        medianDeltaPercent: (median(candidateSamples) / median(baseSamples) - 1) * 100 }));
}
