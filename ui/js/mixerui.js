// Interface de la table de mixage (2 voies, façon DJM).
import { knob, vfader, hfader, toggle, seg, live, vuMeter } from './widgets.js';
import { FX_TYPES, FX_BEATS } from './engine.js';

const beatLabel = (b) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[b] || String(b));

export function buildMixer(root, engine, C) {
  root.innerHTML = `
    <div class="strip" id="strip-A"></div>
    <div class="vu" id="vu-A" data-ctl="A.vu" title="VU-mètre de la voie A (avant le fader). Vise le haut du vert / début du jaune, jamais le rouge."></div>
    <div class="center">
      <div class="box" data-ctl="masterbox"><div class="boxt">Master</div>
        <div class="row" style="align-items:center"><div class="k-master"></div><div class="vu stereo" id="vu-M" data-ctl="master.vu" style="height:84px;width:34px" title="VU-mètre master (avant le limiteur). Le rouge = saturation : sur un vrai système ça distord !"><div></div><div></div></div></div>
        <button class="btn" data-lim style="width:100%;margin-top:-4px">LIMITEUR</button>
      </div>
      <div class="box" data-ctl="phonesbox"><div class="boxt">Casque</div>
        <div class="row"><div class="k-pmix"></div><div class="k-plev"></div></div>
      </div>
      <div class="box" data-ctl="fxbox"><div class="boxt">Beat FX</div>
        <div class="fxdisp num"></div>
        <div class="fxtype" style="margin-bottom:5px"></div>
        <div class="fxbeat"><button class="btn" data-fxb="-1">◀</button><span class="num fxb"></span><button class="btn" data-fxb="1">▶</button></div>
        <div class="fxch" style="margin-bottom:6px"></div>
        <div class="row" style="padding-bottom:12px;align-items:center"><div class="k-fxl"></div><button class="btn lit-r fxon" style="width:52px;height:34px">ON</button></div>
      </div>
    </div>
    <div class="vu" id="vu-B" data-ctl="B.vu" title="VU-mètre de la voie B (avant le fader)."></div>
    <div class="strip" id="strip-B"></div>
    <div class="xfrow">
      <div class="assign"><div class="lbl">Assign A</div><div class="xa-A"></div></div>
      <div><div class="xf"></div><div style="display:flex;justify-content:center;margin-top:3px"><div class="xfc"></div></div></div>
      <div class="assign"><div class="lbl">Assign B</div><div class="xa-B"></div></div>
    </div>`;
  const $ = (s) => root.querySelector(s);

  for (const d of ['A', 'B']) {
    const s = $(`#strip-${d}`);
    const col = d === 'A' ? '#2ea8ff' : '#ff8a1f';
    s.innerHTML = `<div class="chname">${d}</div><div class="k trim"></div><div class="eqsep"></div><div class="k hi"></div><div class="k mid"></div><div class="k low"></div><div class="eqsep"></div><div class="k filter"></div>
      <button class="btn cuebtn lit-y" title="CUE casque">CUE 🎧</button><div class="fd"></div>`;
    knob(s.querySelector('.trim'), C.get(`${d}.trim`), { label: 'TRIM' });
    knob(s.querySelector('.hi'), C.get(`${d}.hi`), { label: 'HI', color: col });
    knob(s.querySelector('.mid'), C.get(`${d}.mid`), { label: 'MID', color: col });
    knob(s.querySelector('.low'), C.get(`${d}.low`), { label: 'LOW', color: col });
    knob(s.querySelector('.filter'), C.get(`${d}.filter`), { label: 'COLOR', color: '#b57bff' });
    toggle(s.querySelector('.cuebtn'), C.get(`${d}.cue`));
    vfader(s.querySelector('.fd'), C.get(`${d}.fader`));
    seg($(`.xa-${d}`), C.get(`${d}.xf`));
  }
  knob($('.k-master'), C.get('master'), { label: 'MASTER' });
  toggle($('[data-lim]'), C.get('limiter'));
  knob($('.k-pmix'), C.get('phonesMix'), { label: 'CUE↔MST', small: true });
  knob($('.k-plev'), C.get('phonesLevel'), { label: 'LEVEL', small: true });
  seg($('.fxtype'), C.get('fx.type'), { echo: 'ECHO', reverb: 'REVERB', flanger: 'FLANGER' });
  seg($('.fxch'), C.get('fx.channel'), { A: 'CH A', B: 'CH B', M: 'MST' });
  knob($('.k-fxl'), C.get('fx.level'), { label: 'LEVEL', color: '#ffd23d', small: true });
  toggle($('.fxon'), C.get('fx.on'));
  $('.fxb').dataset.ctl = 'fx.beat';
  root.querySelectorAll('[data-fxb]').forEach((b) => (b.onclick = () => {
    const i = FX_BEATS.indexOf(engine.mix.fx.beat);
    engine.set('fx.beat', FX_BEATS[Math.max(0, Math.min(FX_BEATS.length - 1, i + Number(b.dataset.fxb)))]);
  }));
  hfader($('.xf'), C.get('xfader'));
  seg($('.xfc'), C.get('xfCurve'), { smooth: 'SMOOTH', cut: 'CUT' });

  const vuA = vuMeter($('#vu-A'), 16), vuB = vuMeter($('#vu-B'), 16);
  const [mL, mR] = $('#vu-M').children; const vuL = vuMeter(mL, 14), vuR = vuMeter(mR, 14);
  const fxd = $('.fxdisp'), fxb = $('.fxb');
  live(() => {
    const lv = engine.levels();
    vuA(lv.A.peak); vuB(lv.B.peak); vuL(lv.L.peak); vuR(lv.R.peak);
    engine.lastLevels = lv;
    const f = engine.mix.fx;
    fxd.textContent = `${FX_TYPES[f.type].toUpperCase()} ${beatLabel(f.beat)}  ${engine.fxBpm().toFixed(0)}`;
    fxb.textContent = beatLabel(f.beat);
  });
}
