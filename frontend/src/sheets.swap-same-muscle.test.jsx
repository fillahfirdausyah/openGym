// @vitest-environment happy-dom
// #473: a swap opens on what trains the same muscle. Mid-workout (Swap exercise) and in the
// routine editor (Replace exercise) the picker starts on the exercises sharing the swapped one's
// target muscle, same equipment first, and "All" is one tap back to the whole list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB } from './lib/exercises.js'
import { exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { sameMuscleFirst } from './lib/similar-exercises.js'

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
// The three filter buttons replace the chip strips: the same-muscle scope lives in the muscle
// filter's sheet, and the muscle button shows which scope is active.
const filterBtn = (host, name) => [...host.querySelectorAll('.filter-btn')]
  .find(b => b.querySelector('.fb-name').textContent.trim() === name)
const isOn = el => el.className.split(/\s+/).includes('on')
const openSheet = (host, name) => { act(() => filterBtn(host, name).click()); return renderTop() }
const option = (sheet, text) => [...sheet.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === text)
const sameOption = sheet => [...sheet.querySelectorAll('.menu-item')].find(e => e.textContent.trim().startsWith('Same muscle'))
const muscleValue = host => filterBtn(host, 'Muscle').querySelector('.fb-value').textContent
const rows = host => [...host.querySelectorAll('.list .item:not(.ex-new)')].map(r => r.querySelector('.ss').textContent)

// A cable triceps exercise: the catalogue has plenty of other triceps work, on cables and off.
const CABLE_TRI = EXDB.find(e => e.tg === 'triceps' && e.eq === 'cable')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('sameMuscleFirst', () => {
  it('keeps the same target muscle, drops the exercise itself, same equipment first, order kept otherwise', () => {
    const ex = { id: 'x', tg: 'triceps', eq: 'cable' }
    const list = [
      { id: 'a', tg: 'triceps', eq: 'dumbbell' },
      { id: 'x', tg: 'triceps', eq: 'cable' },
      { id: 'b', tg: 'biceps', eq: 'cable' },
      { id: 'c', tg: 'triceps', eq: 'cable' },
      { id: 'd', tg: 'triceps', eq: 'barbell' },
      { id: 'e', tg: 'triceps', eq: 'cable' }
    ]
    expect(sameMuscleFirst(list, ex).map(e => e.id)).toEqual(['c', 'e', 'a', 'd'])
    expect(sameMuscleFirst(list, { id: 'y' })).toEqual([])
  })
})

describe('swap picker opens on the same muscle', () => {
  it('mid-workout: Swap exercise starts on the target muscle, same equipment first, All goes back', () => {
    expect(CABLE_TRI).toBeTruthy()
    const S = structuredClone(DEF)
    S.active = {
      id: 'w', d: '2026-10-08', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ id: CABLE_TRI.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
    }
    useStore.setState({ S, user: null })
    swapActiveWorkoutExercise(0)
    const host = renderTop()

    expect(muscleValue(host)).toContain('Triceps')
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(true)

    const listed = rows(host)
    expect(listed.length).toBeGreaterThan(1)
    expect(listed.every(s => s.startsWith('Triceps'))).toBe(true)
    // Cable first: once something else shows up, no cable exercise follows it.
    const firstOther = listed.findIndex(s => !s.endsWith('cable'))
    expect(listed[0].endsWith('cable')).toBe(true)
    if (firstOther > 0) expect(listed.slice(firstOther).some(s => s.endsWith('cable'))).toBe(false)
    // The exercise being swapped away is not offered as its own replacement.
    expect([...host.querySelectorAll('.list .item .tt')].map(x => x.textContent)).not.toContain(CABLE_TRI.n)

    // "All" is one tap back to the whole list.
    { const it = option(openSheet(host, 'Muscle'), 'All'); act(() => it.click()) }
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(false)
    expect(rows(host).some(s => !s.startsWith('Triceps'))).toBe(true)
    // …and back again.
    { const it = option(openSheet(host, 'Muscle'), 'Same muscle: Triceps'); act(() => it.click()) }
    expect(rows(host).every(s => s.startsWith('Triceps'))).toBe(true)
  })

  // The routine editor hands its slot's exercise in (views/RoutineEdit.replace.test.jsx).
  it('routine editor: a picker told what it replaces opens on that muscle', () => {
    const pick = vi.fn()
    exercisePicker(pick, { title: 'Replace exercise', like: CABLE_TRI.id })
    const host = renderTop()
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(true)
    expect(rows(host).every(s => s.startsWith('Triceps'))).toBe(true)
  })

  it('an add opens on the whole list, with no same-muscle option', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(muscleValue(host)).toBe('All')
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(false)
    expect(sameOption(openSheet(host, 'Muscle'))).toBeFalsy()
  })

  it('opens on All when nothing else trains that muscle, so a swap never starts on an empty list', () => {
    const S = structuredClone(DEF)
    // Every catalogue muscle has body-weight work, which no equipment profile hides, so the empty
    // case is one of your own exercises on a muscle nothing else names.
    S.customEx = [{ id: 'cOnly', n: 'My odd lift', bp: 'neck', tg: 'nothing-else', eq: 'body weight', custom: true }]
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: 'cOnly' })
    const host = renderTop()
    expect(muscleValue(host)).toBe('All')
    expect(isOn(filterBtn(host, 'Muscle'))).toBe(false)
    expect(sameOption(openSheet(host, 'Muscle'))).toBeFalsy()
  })
})
