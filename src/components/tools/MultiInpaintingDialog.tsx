import { useState, useRef, useEffect, MouseEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useGenerationStore, INPAINT_REGION_COLORS, InpaintRegion } from '@/stores/generation-store'
import { useToolsStore } from '@/stores/tools-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Eraser, Trash2, Save, Plus, Users, Image, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'

interface MultiInpaintingDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    sourceImage: string | null
}

export function MultiInpaintingDialog({ open, onOpenChange, sourceImage: propSourceImage }: MultiInpaintingDialogProps) {
    const { t } = useTranslation()
    const {
        setSourceImage,
        setMask,
        setI2IMode,
        multiInpaintEnabled,
        setMultiInpaintEnabled,
        inpaintRegions,
        addInpaintRegion,
        removeInpaintRegion,
        updateInpaintRegion,
        activeRegionIndex,
        setActiveRegionIndex
    } = useGenerationStore()

    const { inpaintingBrushSize, setInpaintingBrushSize } = useToolsStore()
    
    // 캐릭터 프롬프트 & 레퍼런스 이미지 스토어
    const { characters: characterPrompts, presets: characterPresets } = useCharacterPromptStore()
    const { characterImages } = useCharacterStore()
    const enabledCharImages = characterImages.filter(img => img.enabled !== false)

    const brushSize = [inpaintingBrushSize]
    const setBrushSize = (val: number[]) => setInpaintingBrushSize(val[0])
    const [isErasing, setIsErasing] = useState(false)

    // Canvas & State
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

    // History (per region) - 추후 undo/redo 구현용
    const [, setHistory] = useState<Map<number, ImageData[]>>(() => new Map())
    const [, setHistoryStep] = useState<Map<number, number>>(() => new Map())

    // 각 영역별 마스크 캔버스 (off-screen)
    const regionCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map())

    // Grid cell size
    const GRID_SIZE = 8
    const gridDataRef = useRef<Map<number, Set<string>>>(new Map())
    const lastGridPosRef = useRef<{ gx: number; gy: number } | null>(null)

    // 현재 활성 영역 색상
    const activeRegion = inpaintRegions[activeRegionIndex]
    const activeColor = activeRegion ? INPAINT_REGION_COLORS[activeRegion.colorIndex] : INPAINT_REGION_COLORS[0]

    // Reset when dialog closes
    useEffect(() => {
        if (!open) {
            setHistory(new Map())
            setHistoryStep(new Map())
            setImageSize(null)
            regionCanvasesRef.current.clear()
            gridDataRef.current.clear()
        }
    }, [open])

    // 캔버스 초기화 및 기존 마스크 복원
    useEffect(() => {
        if (!open || !propSourceImage) return

        const timer = setTimeout(() => {
            const canvas = canvasRef.current
            if (!canvas) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return

            const img = document.createElement('img')
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                canvas.width = img.width
                canvas.height = img.height
                setImageSize({ width: img.width, height: img.height })

                // 영역별 캔버스 초기화
                regionCanvasesRef.current.clear()
                gridDataRef.current.clear()
                
                inpaintRegions.forEach((regionItem, idx) => {
                    const regionCanvas = document.createElement('canvas')
                    regionCanvas.width = img.width
                    regionCanvas.height = img.height
                    regionCanvasesRef.current.set(idx, regionCanvas)
                    gridDataRef.current.set(idx, new Set<string>())
                    
                    // 기존 마스크 복원
                    if (regionItem.maskData) {
                        const maskImg = document.createElement('img')
                        maskImg.crossOrigin = 'anonymous'
                        maskImg.onload = () => {
                            const rCtx = regionCanvas.getContext('2d')
                            if (rCtx) {
                                rCtx.drawImage(maskImg, 0, 0)
                            }
                            redrawMainCanvas()
                        }
                        maskImg.src = regionItem.maskData
                    }
                })
                
                redrawMainCanvas()
            }
            img.src = propSourceImage
        }, 100)
        return () => clearTimeout(timer)
    }, [open, propSourceImage, inpaintRegions.length])

    // 메인 캔버스에 모든 영역 합성
    const redrawMainCanvas = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // 각 영역 순서대로 그리기
        inpaintRegions.forEach((_, idx) => {
            const regionCanvas = regionCanvasesRef.current.get(idx)
            if (regionCanvas) {
                ctx.drawImage(regionCanvas, 0, 0)
            }
        })
    }

    // Convert pixel to grid coords
    const pixelToGrid = (pixelX: number, pixelY: number, canvasWidth: number, canvasHeight: number) => {
        const gx = Math.floor(pixelX / GRID_SIZE)
        const gy = Math.floor(pixelY / GRID_SIZE)
        const maxGx = Math.floor(canvasWidth / GRID_SIZE) - 1
        const maxGy = Math.floor(canvasHeight / GRID_SIZE) - 1
        return {
            gx: Math.max(0, Math.min(gx, maxGx)),
            gy: Math.max(0, Math.min(gy, maxGy))
        }
    }

    // Fill grid cell on region canvas
    const fillGridCell = (regionIdx: number, gx: number, gy: number, erase: boolean) => {
        const regionCanvas = regionCanvasesRef.current.get(regionIdx)
        if (!regionCanvas) return

        const ctx = regionCanvas.getContext('2d')
        if (!ctx) return

        const gridData = gridDataRef.current.get(regionIdx)
        if (!gridData) return

        const cellKey = `${gx},${gy}`

        if (erase) {
            ctx.clearRect(gx * GRID_SIZE, gy * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            gridData.delete(cellKey)
        } else {
            if (gridData.has(cellKey)) return
            const region = inpaintRegions[regionIdx]
            const color = INPAINT_REGION_COLORS[region?.colorIndex ?? 0]
            ctx.fillStyle = color.colorRgba
            ctx.fillRect(gx * GRID_SIZE, gy * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            gridData.add(cellKey)
        }
    }

    // Fill brush area
    const fillBrushArea = (regionIdx: number, gx: number, gy: number, erase: boolean) => {
        const brushGridSize = Math.max(1, Math.floor(brushSize[0] / GRID_SIZE))
        const halfBrush = Math.floor(brushGridSize / 2)

        for (let offsetY = -halfBrush; offsetY <= halfBrush; offsetY++) {
            for (let offsetX = -halfBrush; offsetX <= halfBrush; offsetX++) {
                const targetGx = gx + offsetX
                const targetGy = gy + offsetY
                if (targetGx >= 0 && targetGy >= 0) {
                    fillGridCell(regionIdx, targetGx, targetGy, erase)
                }
            }
        }
        redrawMainCanvas()
    }

    // Draw line
    const drawGridLine = (regionIdx: number, startGx: number, startGy: number, endGx: number, endGy: number, erase: boolean) => {
        const dx = Math.abs(endGx - startGx)
        const dy = Math.abs(endGy - startGy)
        const sx = startGx < endGx ? 1 : -1
        const sy = startGy < endGy ? 1 : -1
        let err = dx - dy
        let gx = startGx
        let gy = startGy

        while (true) {
            fillBrushArea(regionIdx, gx, gy, erase)
            if (gx === endGx && gy === endGy) break
            const e2 = 2 * err
            if (e2 > -dy) { err -= dy; gx += sx }
            if (e2 < dx) { err += dx; gy += sy }
        }
    }

    const startDrawing = (e: MouseEvent<HTMLCanvasElement>) => {
        if (inpaintRegions.length === 0) return
        
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        const { gx, gy } = pixelToGrid(x, y, canvas.width, canvas.height)
        lastGridPosRef.current = { gx, gy }
        fillBrushArea(activeRegionIndex, gx, gy, isErasing)
        setIsDrawing(true)
    }

    const stopDrawing = () => {
        if (isDrawing) {
            setIsDrawing(false)
            saveRegionMask(activeRegionIndex)
        }
        lastGridPosRef.current = null
    }

    const draw = (e: MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !lastGridPosRef.current || inpaintRegions.length === 0) return

        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        const { gx, gy } = pixelToGrid(x, y, canvas.width, canvas.height)

        if (gx !== lastGridPosRef.current.gx || gy !== lastGridPosRef.current.gy) {
            drawGridLine(activeRegionIndex, lastGridPosRef.current.gx, lastGridPosRef.current.gy, gx, gy, isErasing)
            lastGridPosRef.current = { gx, gy }
        }
    }

    // 영역 마스크 저장
    const saveRegionMask = (regionIdx: number) => {
        const regionCanvas = regionCanvasesRef.current.get(regionIdx)
        if (!regionCanvas) return

        const maskDataUrl = regionCanvas.toDataURL('image/png')
        const region = inpaintRegions[regionIdx]
        if (region) {
            updateInpaintRegion(region.id, { maskData: maskDataUrl })
        }
    }

    // 영역 초기화
    const clearRegion = (regionIdx: number) => {
        const regionCanvas = regionCanvasesRef.current.get(regionIdx)
        if (!regionCanvas) return

        const ctx = regionCanvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, regionCanvas.width, regionCanvas.height)
        gridDataRef.current.get(regionIdx)?.clear()
        
        const region = inpaintRegions[regionIdx]
        if (region) {
            updateInpaintRegion(region.id, { maskData: null })
        }
        
        redrawMainCanvas()
    }

    // 영역 추가
    const handleAddRegion = () => {
        if (inpaintRegions.length >= 6) return

        addInpaintRegion()
        
        // 새 영역용 캔버스 생성
        if (imageSize) {
            const newIdx = inpaintRegions.length
            const regionCanvas = document.createElement('canvas')
            regionCanvas.width = imageSize.width
            regionCanvas.height = imageSize.height
            regionCanvasesRef.current.set(newIdx, regionCanvas)
            gridDataRef.current.set(newIdx, new Set<string>())
        }
    }

    // 마스크 저장 및 닫기
    const handleSaveMask = () => {
        if (!propSourceImage) return

        // 모든 영역의 마스크 저장
        inpaintRegions.forEach((_, idx) => saveRegionMask(idx))

        // 단일 인페인팅 모드인 경우 기존 방식 유지
        if (!multiInpaintEnabled || inpaintRegions.length === 0) {
            const canvas = canvasRef.current
            if (canvas) {
                const maskDataUrl = canvas.toDataURL('image/png')
                setSourceImage(propSourceImage)
                setMask(maskDataUrl)
                setI2IMode('inpaint')
            }
        } else {
            // 다인 모드: 첫 번째 영역 마스크로 설정 (생성 시 순차 처리)
            const firstRegion = inpaintRegions[0]
            if (firstRegion?.maskData) {
                setSourceImage(propSourceImage)
                setMask(firstRegion.maskData)
                setI2IMode('inpaint')
            }
        }

        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
            <DialogContent className="flex flex-col p-6 gap-4" style={{ maxWidth: '80vw', maxHeight: '90vh', width: '80vw', height: '90vh' }}>
                <DialogHeader className="mb-0 shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Paintbrush className="w-5 h-5" />
                        {t('tools.multiInpainting.title', '다인 인페인팅')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('tools.multiInpainting.description', '영역별로 다른 캐릭터를 생성합니다. 색상별로 마스크를 그리고 캐릭터를 바인딩하세요.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
                    {/* 좌측: 캔버스 영역 */}
                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {/* 툴바 */}
                        <div className="flex gap-4 shrink-0 items-center justify-between p-2 bg-muted/20 rounded-lg border">
                            <div className="flex items-center gap-2">
                                <Button
                                    variant={!isErasing ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setIsErasing(false)}
                                    className={cn(!isErasing && "bg-primary text-primary-foreground hover:bg-primary/90")}
                                    disabled={inpaintRegions.length === 0}
                                >
                                    <Paintbrush className="w-4 h-4 mr-2" />
                                    {t('common.brush', 'Brush')}
                                </Button>
                                <Button
                                    variant={isErasing ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setIsErasing(true)}
                                    className={cn(isErasing && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                                    disabled={inpaintRegions.length === 0}
                                >
                                    <Eraser className="w-4 h-4 mr-2" />
                                    {t('common.eraser', 'Eraser')}
                                </Button>
                            </div>

                            <div className="flex items-center gap-3">
                                <Label className="text-sm whitespace-nowrap">{t('common.size', 'Size')}</Label>
                                <Slider
                                    value={brushSize}
                                    min={5}
                                    max={100}
                                    step={5}
                                    onValueChange={setBrushSize}
                                    className="w-28"
                                />
                                <span className="text-xs text-muted-foreground w-8 text-center">{brushSize[0]}</span>
                            </div>

                            <div className="flex items-center gap-1">
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => clearRegion(activeRegionIndex)}
                                    disabled={inpaintRegions.length === 0}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>

                            {/* 현재 영역 색상 표시 */}
                            {inpaintRegions.length > 0 && (
                                <div className="flex items-center gap-2 px-3 py-1 rounded border" style={{ borderColor: activeColor.color }}>
                                    <div 
                                        className="w-4 h-4 rounded-full border-2"
                                        style={{ backgroundColor: activeColor.color }}
                                    />
                                    <span className="text-sm font-medium">
                                        {t('tools.multiInpainting.region', '영역')} {activeRegionIndex + 1}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* 캔버스 */}
                        <div
                            ref={containerRef}
                            className="flex-1 relative overflow-hidden rounded-lg bg-muted/50 flex items-center justify-center p-4 min-h-0"
                        >
                            {propSourceImage && (
                                <div
                                    className="relative flex justify-center items-center"
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        aspectRatio: imageSize ? `${imageSize.width} / ${imageSize.height}` : 'auto'
                                    }}
                                >
                                    <img
                                        src={propSourceImage}
                                        alt="Source"
                                        className="block w-full h-full object-contain"
                                        onLoad={(e) => {
                                            const img = e.currentTarget
                                            setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
                                            if (canvasRef.current) {
                                                canvasRef.current.width = img.naturalWidth
                                                canvasRef.current.height = img.naturalHeight
                                            }
                                        }}
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        className={cn(
                                            "absolute top-0 left-0 w-full h-full touch-none opacity-60",
                                            inpaintRegions.length > 0 ? "cursor-crosshair" : "cursor-not-allowed"
                                        )}
                                        onMouseDown={startDrawing}
                                        onMouseMove={draw}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                    />
                                </div>
                            )}

                            {/* 영역 없음 안내 */}
                            {inpaintRegions.length === 0 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                                    <div className="text-center p-6">
                                        <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                                        <p className="text-muted-foreground mb-4">
                                            {t('tools.multiInpainting.noRegions', '오른쪽에서 영역을 추가하세요')}
                                        </p>
                                        <Button onClick={handleAddRegion} variant="outline">
                                            <Plus className="w-4 h-4 mr-2" />
                                            {t('tools.multiInpainting.addRegion', '영역 추가')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 우측: 영역 리스트 */}
                    <div className="w-[320px] flex flex-col gap-3 shrink-0">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold">
                                {t('tools.multiInpainting.regions', '인페인트 영역')}
                            </h3>
                            <Button 
                                size="sm" 
                                variant="outline"
                                onClick={handleAddRegion}
                                disabled={inpaintRegions.length >= 6}
                            >
                                <Plus className="w-4 h-4 mr-1" />
                                {t('common.add', '추가')}
                            </Button>
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="space-y-3 pr-2">
                                {inpaintRegions.map((region, idx) => (
                                    <RegionCard
                                        key={region.id}
                                        region={region}
                                        index={idx}
                                        isActive={idx === activeRegionIndex}
                                        characterPrompts={characterPrompts}
                                        characterPresets={characterPresets}
                                        characterImages={enabledCharImages}
                                        onSelect={() => setActiveRegionIndex(idx)}
                                        onUpdate={(updates) => updateInpaintRegion(region.id, updates)}
                                        onRemove={() => removeInpaintRegion(region.id)}
                                        onClear={() => clearRegion(idx)}
                                        t={t}
                                    />
                                ))}

                                {inpaintRegions.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <p className="text-sm">
                                            {t('tools.multiInpainting.noRegionsHint', '영역을 추가하여 시작하세요')}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>

                        {/* 다인 모드 토글 */}
                        <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                            <div>
                                <Label className="font-medium">
                                    {t('tools.multiInpainting.multiMode', '다인 모드')}
                                </Label>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {t('tools.multiInpainting.multiModeDesc', '영역별 순차 생성')}
                                </p>
                            </div>
                            <Switch
                                checked={multiInpaintEnabled}
                                onChange={(e) => setMultiInpaintEnabled(e.target.checked)}
                                disabled={inpaintRegions.length < 2}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-2 sm:justify-end items-center gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button
                        className="bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white"
                        onClick={handleSaveMask}
                        disabled={!propSourceImage || inpaintRegions.length === 0}
                    >
                        <Save className="w-4 h-4 mr-2" />
                        {t('sourcePanel.saveMask', '마스크 저장')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// 영역 카드 컴포넌트
interface RegionCardProps {
    region: InpaintRegion
    index: number
    isActive: boolean
    characterPrompts: { id: string; name?: string; prompt: string }[]
    characterPresets: { id: string; name: string; prompt: string }[]
    characterImages: { id: string; base64: string }[]
    onSelect: () => void
    onUpdate: (updates: Partial<InpaintRegion>) => void
    onRemove: () => void
    onClear: () => void
    t: ReturnType<typeof useTranslation>['t']
}

function RegionCard({
    region,
    index,
    isActive,
    characterPrompts,
    characterPresets,
    characterImages,
    onSelect,
    onUpdate,
    onRemove,
    onClear,
    t
}: RegionCardProps) {
    const color = INPAINT_REGION_COLORS[region.colorIndex]

    return (
        <div
            className={cn(
                "border rounded-lg p-3 space-y-3 transition-all cursor-pointer",
                isActive 
                    ? "border-2 bg-muted/30" 
                    : "border-border/50 hover:border-border"
            )}
            style={{ borderColor: isActive ? color.color : undefined }}
            onClick={onSelect}
        >
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div 
                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ backgroundColor: color.color, borderColor: color.color }}
                    >
                        {index + 1}
                    </div>
                    <span className="font-medium text-sm">
                        {t('tools.multiInpainting.region', '영역')} {index + 1}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); onClear() }}
                    >
                        <Eraser className="w-3 h-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); onRemove() }}
                    >
                        <X className="w-3 h-3" />
                    </Button>
                </div>
            </div>

            {/* 캐릭터 프롬프트 바인딩 */}
            <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {t('tools.multiInpainting.bindPrompt', '캐릭터 프롬프트')}
                </Label>
                <Select
                    value={region.characterPromptId || 'none'}
                    onValueChange={(v) => onUpdate({ characterPromptId: v === 'none' ? null : v })}
                >
                    <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={t('tools.multiInpainting.selectPrompt', '선택...')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">
                            {t('tools.multiInpainting.noBinding', '없음')}
                        </SelectItem>
                        {/* 스테이지의 캐릭터들 */}
                        {characterPrompts.length > 0 && (
                            <>
                                <div className="px-2 py-1 text-xs text-muted-foreground font-medium">
                                    {t('tools.multiInpainting.stageChars', '스테이지')}
                                </div>
                                {characterPrompts.map(cp => (
                                    <SelectItem key={cp.id} value={cp.id}>
                                        {cp.name || cp.prompt.slice(0, 30)}
                                    </SelectItem>
                                ))}
                            </>
                        )}
                        {/* 프리셋 */}
                        {characterPresets.length > 0 && (
                            <>
                                <div className="px-2 py-1 text-xs text-muted-foreground font-medium border-t mt-1 pt-1">
                                    {t('tools.multiInpainting.presets', '프리셋')}
                                </div>
                                {characterPresets.slice(0, 10).map(preset => (
                                    <SelectItem key={preset.id} value={`preset:${preset.id}`}>
                                        {preset.name}
                                    </SelectItem>
                                ))}
                            </>
                        )}
                    </SelectContent>
                </Select>
            </div>

            {/* 참조 이미지 바인딩 */}
            <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Image className="w-3 h-3" />
                    {t('tools.multiInpainting.bindReference', '참조 이미지')}
                </Label>
                <Select
                    value={region.referenceImageId || 'none'}
                    onValueChange={(v) => onUpdate({ referenceImageId: v === 'none' ? null : v })}
                >
                    <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={t('tools.multiInpainting.selectRef', '선택...')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">
                            {t('tools.multiInpainting.noBinding', '없음')}
                        </SelectItem>
                        {characterImages.map((img, imgIdx) => (
                            <SelectItem key={img.id} value={img.id}>
                                <div className="flex items-center gap-2">
                                    <img 
                                        src={img.base64} 
                                        alt=""
                                        className="w-6 h-6 rounded object-cover"
                                    />
                                    <span>{t('tools.multiInpainting.refImage', '이미지')} {imgIdx + 1}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 마스크 미리보기 */}
            {region.maskData && (
                <div className="pt-2 border-t border-border/30">
                    <img 
                        src={region.maskData} 
                        alt="Mask preview"
                        className="w-full h-16 object-contain rounded bg-muted/50"
                    />
                </div>
            )}
        </div>
    )
}
