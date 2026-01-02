import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

export const RESOLUTION_PRESETS = [
    { key: 'portrait', width: 832, height: 1216 },
    { key: 'landscape', width: 1216, height: 832 },
    { key: 'square', width: 1024, height: 1024 },
    { key: 'tallPortrait', width: 640, height: 1536 },
    { key: 'wideLandscape', width: 1536, height: 640 },
]

export interface Resolution {
    label: string
    width: number
    height: number
}

interface ResolutionSelectorProps {
    value: Resolution
    onChange: (resolution: Resolution) => void
    disabled?: boolean
}


export function ResolutionSelector({ value, onChange, disabled }: ResolutionSelectorProps) {
    const { t } = useTranslation()
    const customResolutions = useSettingsStore(state => state.customResolutions)
    const addCustomResolution = useSettingsStore(state => state.addCustomResolution)

    const [customWidth, setCustomWidth] = useState(1024)
    const [customHeight, setCustomHeight] = useState(1024)
    const [customDialogOpen, setCustomDialogOpen] = useState(false)
    const [customLabel, setCustomLabel] = useState('Custom')

    // Find if current value matches a standard preset
    const standardPreset = RESOLUTION_PRESETS.find(
        (p) => p.width === value.width && p.height === value.height
    )

    // Find if current value matches a custom preset
    const customPreset = customResolutions.find(
        (p) => p.width === value.width && p.height === value.height
    )

    // Determine selected value
    let selectedValue = 'custom_value'
    if (standardPreset) selectedValue = standardPreset.key
    else if (customPreset) selectedValue = `custom_${customPreset.id}`

    const handleValueChange = (val: string) => {
        if (val === 'custom') {
            // Use setTimeout to prevent Radix UI Portal conflict (NotFoundError)
            // This allows the Select to close fully before the Dialog opens
            setTimeout(() => {
                setCustomDialogOpen(true)
            }, 0)
            return
        }

        if (val.startsWith('custom_')) {
            const id = val.replace('custom_', '')
            const preset = customResolutions.find(p => String(p.id) === id)
            if (preset) {
                onChange({
                    label: preset.label,
                    width: preset.width,
                    height: preset.height,
                })
            }
            return
        }

        const preset = RESOLUTION_PRESETS.find((p) => p.key === val)
        if (preset) {
            onChange({
                label: t(`resolutions.${preset.key}`),
                width: preset.width,
                height: preset.height,
            })
        }
    }

    const handleCustomSave = () => {
        const label = customLabel || `${customWidth}x${customHeight}`
        const width = Number(customWidth)
        const height = Number(customHeight)

        // Save to store
        addCustomResolution({
            label,
            width,
            height,
        })

        // Apply immediately
        onChange({
            label,
            width,
            height,
        })
        setCustomDialogOpen(false)
    }

    return (
        <>
            <Select
                value={selectedValue}
                onValueChange={handleValueChange}
                disabled={disabled}
            >
                <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('resolutions.portrait')}>
                        {standardPreset ? undefined : (customPreset ? customPreset.label : `${value.width} × ${value.height}`)}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {RESOLUTION_PRESETS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                            <span className="flex items-center justify-between w-full min-w-[180px]">
                                <span>{t(`resolutions.${p.key}`)}</span>
                                <span className="text-xs text-muted-foreground ml-2">
                                    {p.width} × {p.height}
                                </span>
                            </span>
                        </SelectItem>
                    ))}

                    {customResolutions.length > 0 && (
                        <>
                            <div className="h-px bg-muted my-1 mx-1" />
                            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                                {t('resolutions.custom', '사용자 정의')}
                            </div>
                            {customResolutions.map((c) => (
                                <SelectItem key={c.id} value={`custom_${c.id}`}>
                                    <span className="flex items-center justify-between w-full min-w-[180px]">
                                        <span>{c.label}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                            {c.width} × {c.height}
                                        </span>
                                    </span>
                                </SelectItem>
                            ))}
                            <div className="h-px bg-muted my-1 mx-1" />
                        </>
                    )}

                    <SelectItem value="custom" className="text-primary font-medium">
                        <span className="flex items-center">
                            <Plus className="mr-2 h-4 w-4" />
                            {t('resolutions.addCustom')}
                        </span>
                    </SelectItem>
                </SelectContent>
            </Select>

            <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen} modal={false}>
                <DialogContent onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>{t('resolutions.addCustom')}</DialogTitle>
                        <DialogDescription>
                            {t('resolutions.addCustomDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">
                                {t('resolutions.presetName')}
                            </Label>
                            <Input
                                id="name"
                                value={customLabel}
                                onChange={(e) => setCustomLabel(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="width" className="text-right">
                                {t('resolutions.width')}
                            </Label>
                            <Input
                                id="width"
                                type="number"
                                value={customWidth}
                                onChange={(e) => setCustomWidth(Number(e.target.value))}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="height" className="text-right">
                                {t('resolutions.height')}
                            </Label>
                            <Input
                                id="height"
                                type="number"
                                value={customHeight}
                                onChange={(e) => setCustomHeight(Number(e.target.value))}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" onClick={handleCustomSave}>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
