import { describe, expect, it } from 'vitest'
import { SidebarPointer, pointOnSidebar } from '../main/overlay/sidebar-pointer'
import { sidebarShellFrame } from '../shared/layout'

const arena = { width: 1512, height: 949 }

describe('pointOnSidebar', () => {
  it('follows the strip to whichever side the phase puts it on', () => {
    const right = sidebarShellFrame(arena, 'right')
    const left = sidebarShellFrame(arena, 'left')
    expect(pointOnSidebar({ x: right.x + 5, y: right.y + 5 }, arena, 'right')).toBe(true)
    expect(pointOnSidebar({ x: right.x - 5, y: right.y + 5 }, arena, 'right')).toBe(false)
    expect(pointOnSidebar({ x: right.x + 5, y: right.y - 5 }, arena, 'right')).toBe(false)
    expect(pointOnSidebar({ x: left.x + left.width - 5, y: left.y + 5 }, arena, 'left')).toBe(true)
    expect(pointOnSidebar({ x: right.x + 5, y: right.y + 5 }, arena, 'left')).toBe(false)
  })

  it('rejects the strip of a degenerate window', () => {
    expect(pointOnSidebar({ x: 1, y: 1 }, { width: 0, height: 0 }, 'right')).toBe(false)
  })
})

describe('SidebarPointer', () => {
  it('claims on entering the strip, releases on leaving, and is quiet in between', () => {
    const pointer = new SidebarPointer()
    expect(pointer.active).toBe(false)
    expect(pointer.update(false)).toBeNull()
    expect(pointer.update(true)).toBe('claim')
    expect(pointer.active).toBe(true)
    expect(pointer.update(true)).toBeNull()
    expect(pointer.update(false)).toBe('release')
    expect(pointer.active).toBe(false)
    expect(pointer.update(false)).toBeNull()
  })

  it('releases when the strip closes under a resting pointer', () => {
    const pointer = new SidebarPointer()
    pointer.update(true)
    // The sidebar closing, the overlay hiding or Arena leaving all feed false.
    expect(pointer.update(false)).toBe('release')
  })
})
