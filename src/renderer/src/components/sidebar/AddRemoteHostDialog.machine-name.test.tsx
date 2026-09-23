// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const storeActions = vi.hoisted(() => ({
  setSshTargetsMetadata: vi.fn(),
  recordSshRepoReadoptions: vi.fn(),
  setRuntimeEnvironments: vi.fn(),
  readRuntimeHostStatusSnapshots: vi.fn(),
  recordFeatureInteraction: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(storeActions)
}))

vi.mock('../settings/MachineNameField', () => ({
  MachineNameField: ({ id }: { id?: string }) => (
    <div data-testid="machine-name-field" data-id={id} />
  )
}))

import { AddRemoteHostDialog } from './AddRemoteHostDialog'

function documentOrder(element: Element): number {
  return Array.from(document.querySelectorAll('*')).indexOf(element)
}

function expectFieldBetweenTitleAndFirstInput(firstInputId: string): void {
  const field = screen.getByTestId('machine-name-field')
  expect(field).toHaveAttribute('data-id', 'add-remote-host-machine-name')
  const title = screen.getByRole('heading')
  const firstInput = document.querySelector(`#${firstInputId}`)
  if (!firstInput) {
    throw new Error(`missing #${firstInputId}`)
  }
  expect(documentOrder(title)).toBeLessThan(documentOrder(field))
  expect(documentOrder(field)).toBeLessThan(documentOrder(firstInput))
}

describe('AddRemoteHostDialog machine name', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', { configurable: true, value: { ssh: {} } })
  })

  afterEach(() => cleanup())

  it('lets this desktop name itself when adding an SSH host', () => {
    render(<AddRemoteHostDialog mode="ssh" onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Add SSH host' })).toBeVisible()
    expectFieldBetweenTitleAndFirstInput('add-ssh-label')
  })

  it('lets this desktop name itself when pairing to a remote server', () => {
    render(<AddRemoteHostDialog mode="server" onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Add remote server' })).toBeVisible()
    expectFieldBetweenTitleAndFirstInput('add-server-name')
  })
})
