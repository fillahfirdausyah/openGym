// @vitest-environment happy-dom
// Issue #71: choosing a body part after picking an equipment type used to reset the equipment
// filter to "all equipment", even when the new muscle group still had exercises for it. The
// per-body-part chips no longer clear the equipment selection; the eqOn fallback only drops it
// for the current view when the new body part has nothing under that equipment. (Now behind the
// three filter buttons: pick a value by opening the dimension's sheet.)
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'

const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

// The three filter buttons replace the chip strips: open a dimension's sheet and tap a value.
const filterBtn = (host, name) => [...host.querySelectorAll('.filter-btn')]
  .find(b => b.querySelector('.fb-name').textContent.trim() === name)
const isOn = el => el.className.split(/\s+/).includes('on')
const openSheet = (host, name) => { act(() => filterBtn(host, name).click()); return renderTop() }
const option = (sheet, text) => [...sheet.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === text)
const pick = (host, name, value) => { const it = option(openSheet(host, name), value); act(() => it.click()); return host }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise picker equipment filter', () => {
  // The exact reproduction from issue #71: "lower arms" + "dumbbell", then switch to "upper arms".
  // Both body parts have dumbbell exercises, so the filter must stay selected across the switch.
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    exercisePicker(vi.fn())
    let host = renderTop()

    // lower arms → dumbbell
    host = pick(host, 'Muscle', 'lower arms')
    host = pick(host, 'Equipment', 'dumbbell')
    expect(filterBtn(host, 'Equipment').querySelector('.fb-value').textContent).toBe('dumbbell')
    expect(isOn(filterBtn(host, 'Equipment'))).toBe(true)

    // switch to upper arms — dumbbell is still valid there, so it must remain selected
    host = pick(host, 'Muscle', 'upper arms')
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(true)
    expect(filterBtn(host, 'Muscle').querySelector('.fb-value').textContent).toBe('upper arms')
    expect(filterBtn(host, 'Equipment').querySelector('.fb-value').textContent).toBe('dumbbell')
    expect(isOn(filterBtn(host, 'Equipment'))).toBe(true)
  })
})
