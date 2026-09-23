import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { MACHINE_NAME_MAX_LENGTH } from '../../../../shared/machine-name'
import { DebouncedSettingsTextInput } from './DebouncedSettingsTextInput'
import { usePublishedMachineName } from './use-published-machine-name'

type MachineNameFieldProps = {
  /** Distinct per mount so two surfaces in one DOM never share an input id. */
  id?: string
}

/**
 * The name other devices and hosts list this computer under, with the detected name as the blank
 * default. One machine-wide setting, so every pairing or connect surface mounts this same field.
 */
export function MachineNameField({
  id = 'machine-name'
}: MachineNameFieldProps): React.JSX.Element | null {
  const machineName = useAppStore((s) => s.settings?.machineName ?? '')
  const updateSettings = useAppStore((s) => s.updateSettings)
  const publishedMachineName = usePublishedMachineName(machineName)
  const descriptionId = `${id}-description`

  // Why: a browser client has no machine of its own to name, and its settings mirror cannot
  // persist one. The host's name is edited on the host.
  if (isWebClientLocation()) {
    return null
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {translate('auto.components.settings.MachineNameField.label', 'Machine name')}
      </label>
      <DebouncedSettingsTextInput
        id={id}
        value={machineName}
        commit={(name) => void updateSettings({ machineName: name })}
        maxLength={MACHINE_NAME_MAX_LENGTH}
        placeholder={
          publishedMachineName ??
          translate(
            'auto.components.settings.MachineNameField.placeholder',
            'Detected automatically'
          )
        }
        aria-describedby={descriptionId}
        // Why: some hosts mount this inside a form whose submit adds a host. Enter commits the name
        // (blur flushes the draft) instead of submitting a half-filled host form.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {publishedMachineName
          ? translate(
              'auto.components.settings.MachineNameField.description',
              'Other devices and hosts see “{{name}}”. Leave this blank to use the computer’s own name.',
              { name: publishedMachineName }
            )
          : translate(
              'auto.components.settings.MachineNameField.pending',
              'Other devices and hosts see this name. Leave it blank to use the detected computer name.'
            )}
      </p>
    </div>
  )
}
