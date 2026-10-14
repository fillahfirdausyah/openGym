// @vitest-environment happy-dom
// Issue #521: the workout's "Add exercise" picker showed the Muscle and Equipment chip rows but not
// the Type row the Exercise browser has (strength, calisthenics, stretching...). Same filter, same
// fallback: a type the muscle group narrows away is ignored for that view, not forgotten. (Now
// behind the three filter buttons.)
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB } from './lib/exercises.js'
import { exerciseNameFor } from './lib/i18n.js'
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
// Every row's add button carries the exercise's name, so it tells which exercises are listed.
const listed = host => [...host.querySelectorAll('.list .item button[aria-label]')]
  .map(b => b.getAttribute('aria-label'))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise picker type filter', () => {
  it('shows three filter buttons — muscle, type, equipment — like the Library', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    const names = [...host.querySelectorAll('.filter-btn')].map(b => b.querySelector('.fb-name').textContent.trim())
    expect(names).toEqual(['Muscle', 'Type', 'Equipment'])
    expect(filterBtn(host, 'Type').querySelector('.fb-value').textContent).toBe('Any type')
    expect(isOn(filterBtn(host, 'Type'))).toBe(false)
    expect(option(openSheet(host, 'Type'), 'stretching')).toBeTruthy()
    expect(filterBtn(host, 'Equipment').querySelector('.fb-value').textContent).toBe('Any equipment')
  })

  it('narrows the list to the picked type', () => {
    exercisePicker(vi.fn())
    let host = renderTop()
    host = pick(host, 'Type', 'stretching')
    expect(isOn(filterBtn(host, 'Type'))).toBe(true)
    const names = listed(host)
    expect(names.length).toBeGreaterThan(0)
    const catOf = new Map(EXDB.map(e => [`Add “${exerciseNameFor(e)}”`, e.cat]))
    expect(names.filter(n => catOf.get(n) !== 'stretching')).toEqual([])
  })

  it('keeps the type across a muscle group that has none of it, and picks it back up', () => {
    exercisePicker(vi.fn())
    let host = renderTop()
    host = pick(host, 'Type', 'yoga')
    // Lower arms have no yoga: the button drops the choice for this view instead of listing nothing.
    host = pick(host, 'Muscle', 'lower arms')
    expect(filterBtn(host, 'Type').querySelector('.fb-value').textContent).toBe('Any type')
    expect(listed(host).length).toBeGreaterThan(0)
    // Back has yoga again: the choice comes back on its own.
    host = pick(host, 'Muscle', 'back')
    expect(filterBtn(host, 'Type').querySelector('.fb-value').textContent).toBe('yoga')
    expect(isOn(filterBtn(host, 'Type'))).toBe(true)
  })
})
