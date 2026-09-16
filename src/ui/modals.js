/**
 * 班級作業登記系統 - 通用彈窗與提示模組 (Modals & Dialogs)
 */

const $ = id => document.getElementById(id);

export function showAlert(msg) {
    const el = $('alertMsg');
    const modal = $('alertModal');
    if (el && modal) {
        el.textContent = msg;
        modal.style.display = 'flex';
    } else {
        alert(msg);
    }
}

export function closeAlert() {
    const modal = $('alertModal');
    if (modal) modal.style.display = 'none';
}

export function askInput(msg, def = '') {
    return new Promise(resolve => {
        const m = $('promptModal'), inp = $('promptInput'), ok = $('promptOk'), no = $('promptNo');
        if (!m || !inp || !ok || !no) {
            resolve(window.prompt(msg, def));
            return;
        }
        $('promptMsg').textContent = msg;
        inp.value = def || '';
        inp.style.display = '';
        m.style.display = 'flex';
        setTimeout(() => { inp.focus(); inp.select(); }, 50);

        const done = (val) => {
            m.style.display = 'none';
            ok.onclick = null;
            no.onclick = null;
            inp.onkeydown = null;
            resolve(val);
        };
        ok.onclick = () => done(inp.value);
        no.onclick = () => done(null);
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') done(inp.value);
            else if (e.key === 'Escape') done(null);
        };
    });
}

export function askConfirm(msg) {
    return new Promise(resolve => {
        const m = $('promptModal'), inp = $('promptInput'), ok = $('promptOk'), no = $('promptNo');
        if (!m || !ok || !no) {
            resolve(window.confirm(msg));
            return;
        }
        $('promptMsg').textContent = msg;
        if (inp) inp.style.display = 'none';
        m.style.display = 'flex';

        const done = (val) => {
            m.style.display = 'none';
            if (inp) inp.style.display = '';
            ok.onclick = null;
            no.onclick = null;
            resolve(val);
        };
        ok.onclick = () => done(true);
        no.onclick = () => done(false);
    });
}

export function askChoice(msg, options) {
    return new Promise(resolve => {
        const m = $('choiceModal'), box = $('choiceButtons'), ok = $('choiceOk'), no = $('choiceCancel');
        if (!m || !box || !ok || !no) {
            resolve(options[0] || null);
            return;
        }
        $('choiceMsg').textContent = msg;
        let selected = null;
        box.innerHTML = options.map(o => `<button type="button" class="btn small outline" data-choice-val="${o}">${o}</button>`).join('');
        box.querySelectorAll('[data-choice-val]').forEach(b => {
            b.onclick = () => {
                selected = b.getAttribute('data-choice-val');
                box.querySelectorAll('[data-choice-val]').forEach(x => (x.className = 'btn small outline'));
                b.className = 'btn small';
            };
        });
        m.style.display = 'flex';

        const done = (val) => {
            m.style.display = 'none';
            ok.onclick = null;
            no.onclick = null;
            resolve(val);
        };
        ok.onclick = () => done(selected);
        no.onclick = () => done(null);
    });
}

