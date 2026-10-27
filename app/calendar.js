const zone = 'America/Santiago';
const formatter = options => new Intl.DateTimeFormat('es-CL', { timeZone: zone, ...options });
const dayParts = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' });
const time = formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fullDay = formatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function dayKey(value) {
  const parts = Object.fromEntries(dayParts.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const utcDay = key => new Date(key + 'T12:00:00Z');

export function bookingCalendar(root, onSelect) {
  let options = [], day = '', month = '', visible = 12;
  function render() {
    onSelect(null);
    if (!options.length) {
      root.innerHTML = '<p class="calendar-empty">No hay horarios disponibles para este tratamiento.</p>';
      return;
    }
    const days = new Set(options.map(s => dayKey(s.starts_at)));
    const months = [...new Set([...days].map(d => d.slice(0, 7)))].sort();
    const [year, monthNumber] = month.split('-').map(Number);
    const first = new Date(Date.UTC(year, monthNumber - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const cells = Array.from({ length: offset }, () => '<span></span>');
    for (let n = 1; n <= count; n++) {
      const key = `${month}-${String(n).padStart(2, '0')}`;
      cells.push(`<button type="button" class="calendar-day" data-day="${key}" aria-label="${escape(fullDay.format(utcDay(key)))}" aria-pressed="${key === day}" ${days.has(key) ? '' : 'disabled'}>${n}${days.has(key) ? '<span class="day-dot" aria-hidden="true"></span>' : ''}</button>`);
    }
    const times = options.filter(s => dayKey(s.starts_at) === day);
    root.innerHTML = `<div class="calendar-header"><button type="button" class="secondary" data-month="prev" aria-label="Mes anterior" ${month <= months[0] ? 'disabled' : ''}>‹</button><h3>${escape(monthName.format(first))}</h3><button type="button" class="secondary" data-month="next" aria-label="Mes siguiente" ${month >= months.at(-1) ? 'disabled' : ''}>›</button></div><div class="calendar-week" aria-hidden="true">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-days" role="group" aria-label="Días disponibles">${cells.join('')}</div><p class="calendar-note">Los días con un punto tienen disponibilidad. Hora de Chile continental.</p><fieldset class="time-fieldset"><legend>${day ? escape(fullDay.format(utcDay(day))) : 'Selecciona un día disponible'}</legend><p>Inicio y fin de tu tratamiento</p><div class="time-grid">${times.slice(0, visible).map((s, i) => `<label class="time-option"><input type="radio" name="slot_choice" required value="${escape(s.slot_id + '|' + s.starts_at)}" data-option="${i}"><span>${escape(time.format(new Date(s.starts_at)))}<span aria-hidden="true"> → </span><span class="sr-only"> hasta </span>${escape(time.format(new Date(s.ends_at)))}${dayKey(s.starts_at) !== dayKey(s.ends_at) ? '<small class="next-day">día siguiente</small>' : ''}</span></label>`).join('')}</div>${times.length > visible ? '<button type="button" class="secondary" id="more-times">Ver más horarios</button>' : ''}${!times.length ? '<p>No hay horas disponibles en este día.</p>' : ''}</fieldset><p id="selected-time" class="selected-time" role="status">Selecciona una hora para continuar.</p>`;
    root.querySelectorAll('[data-day]').forEach(button => button.onclick = () => { day = button.dataset.day; visible = 12; render(); root.querySelector(`[data-day="${day}"]`).focus(); });
    root.querySelectorAll('[data-month]').forEach(button => button.onclick = () => {
      const step = button.dataset.month === 'next' ? 1 : -1;
      const next = new Date(Date.UTC(year, monthNumber - 1 + step, 1));
      month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
      day = [...days].sort().find(d => d.startsWith(month)) || '';
      visible = 12;
      render();
      root.querySelector(`[data-month="${button.dataset.month}"]`).focus();
    });
    root.querySelectorAll('[data-option]').forEach(input => input.onchange = () => {
      const selected = times[Number(input.dataset.option)];
      root.querySelector('#selected-time').textContent = `${fullDay.format(new Date(selected.starts_at))} · ${time.format(new Date(selected.starts_at))} a ${time.format(new Date(selected.ends_at))}${dayKey(selected.starts_at) !== dayKey(selected.ends_at) ? ' (día siguiente)' : ''} · ${Math.round((new Date(selected.ends_at) - new Date(selected.starts_at)) / 60000)} minutos`;
      onSelect(selected);
    });
    const more = root.querySelector('#more-times');
    if (more) more.onclick = () => {
      const chosen = root.querySelector('[name=slot_choice]:checked')?.value;
      const nextIndex = visible;
      visible += 12;
      render();
      if (chosen) {
        const input = [...root.querySelectorAll('[name=slot_choice]')].find(i => i.value === chosen);
        if (input) { input.checked = true; input.onchange(); }
      }
      root.querySelectorAll('[name=slot_choice]')[nextIndex]?.focus();
    };
  }
  return {
    update(rows, serviceChosen) {
      options = [...rows].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      visible = 12;
      if (!serviceChosen) {
        onSelect(null);
        root.innerHTML = '<p class="calendar-empty">Primero elige un tratamiento para ver sus días y horas disponibles.</p>';
        return;
      }
      const days = options.map(s => dayKey(s.starts_at));
      day = days.includes(day) ? day : days[0] || '';
      month = day.slice(0, 7);
      render();
    }
  };
}
