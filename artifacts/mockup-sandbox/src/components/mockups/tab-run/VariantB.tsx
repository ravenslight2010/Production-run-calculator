import React, { useState } from "react";
import {
  Play,
  Pause,
  Square,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Snowflake,
  Timer,
  Settings2,
  TrendingDown,
  Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

export function VariantB() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex flex-col w-full max-w-[620px] mx-auto border-x border-neutral-800 relative selection:bg-amber-500/30 pb-20">
      
      {/* SLIM STICKY HEADER */}
      <header className="sticky top-0 z-50 bg-neutral-950/90 backdrop-blur-md border-b border-neutral-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight text-white flex items-baseline space-x-2">
              <span>Cornerbooth</span>
              <span className="text-sm font-medium text-neutral-400">Pepperoni</span>
            </h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-neutral-400">
            <span>Run 2 of 4</span>
            <div className="flex space-x-1">
              <Button variant="outline" size="icon" className="w-7 h-7 bg-transparent border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" className="w-7 h-7 bg-transparent border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Target</span>
              <div className="flex items-baseline space-x-1">
                <span className="text-2xl font-black text-amber-500">850</span>
                <span className="text-xs text-neutral-400">cases</span>
              </div>
            </div>
            <Separator orientation="vertical" className="h-8 bg-neutral-800" />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Elapsed</span>
              <div className="flex items-baseline space-x-1">
                <span className="text-xl font-bold text-white">2h 14m</span>
              </div>
            </div>
            <Separator orientation="vertical" className="h-8 bg-neutral-800" />
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-neutral-900 border-neutral-700 text-neutral-300">TX-16</Badge>
              <Badge variant="outline" className="bg-neutral-900 border-neutral-700 text-neutral-300">Contains: Wheat, Milk</Badge>
            </div>
          </div>

          <div className="flex space-x-2">
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-bold h-9">
              <Pause className="w-4 h-4 mr-1" fill="currentColor" /> Pause
            </Button>
            <Button variant="outline" size="sm" className="bg-transparent border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800 h-9">
              <Square className="w-4 h-4 mr-1" fill="currentColor" /> Stop
            </Button>
          </div>
        </div>
        
        {/* Subtle Last Ran Recall */}
        <div className="text-[10px] text-neutral-500 flex justify-between">
          <span>Last ran: 2 days ago</span>
          <span>Prev: Aldo's Cheese | Next: Cornerbooth Sausage</span>
        </div>
      </header>

      {/* TIMELINE METAPHOR */}
      <section className="px-4 py-6 border-b border-neutral-800 bg-neutral-900/50 overflow-hidden relative">
        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-neutral-400">Est. Finish</span>
            <span className="text-3xl font-black text-white">4:37 PM</span>
            <span className="text-xs font-medium text-red-400 flex items-center mt-1">
              <TrendingDown className="w-3 h-3 mr-1" /> 8 min behind
            </span>
          </div>
          <div className="text-right flex flex-col items-end">
            <span className="text-sm font-medium text-neutral-400">Time Left</span>
            <span className="text-3xl font-black text-amber-500">1h 52m</span>
            <span className="text-xs font-medium text-neutral-500 mt-1">314 / 850 (37%)</span>
          </div>
        </div>

        {/* Timeline visualization */}
        <div className="relative h-16 mt-6 mb-2">
          {/* Track */}
          <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-neutral-800 -translate-y-1/2 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 w-[37%]" />
          </div>

          {/* Nodes */}
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          
          <div className="absolute top-1/2 left-[20%] -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-4 border-neutral-950 bg-amber-500" />
          <div className="absolute top-[15px] left-[20%] -translate-x-1/2 text-[10px] font-bold text-amber-500 uppercase tracking-wider whitespace-nowrap">Freezer Fill</div>
          
          <div className="absolute top-1/2 left-[40%] -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-neutral-950 bg-neutral-600" />
          <div className="absolute top-[15px] left-[40%] -translate-x-1/2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider whitespace-nowrap">Steady State</div>

          <div className="absolute top-1/2 left-[80%] -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-neutral-950 bg-neutral-600" />
          <div className="absolute top-[15px] left-[80%] -translate-x-1/2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider whitespace-nowrap">Feed Done</div>

          <div className="absolute top-1/2 right-0 -translate-y-1/2 w-3 h-3 rounded-full bg-neutral-700" />
          <div className="absolute top-[15px] right-0 translate-x-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider whitespace-nowrap">Finish</div>

          {/* You are here marker */}
          <div className="absolute top-1/2 left-[37%] -translate-x-1/2 -translate-y-[130%] flex flex-col items-center">
            <div className="bg-white text-black text-xs font-bold px-2 py-0.5 rounded shadow-lg">You are here</div>
            <div className="w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-white" />
          </div>

          {/* Milestones placed on timeline */}
          <div className="absolute top-1/2 left-[45%] -translate-x-1/2 translate-y-3 flex flex-col items-center">
            <div className="w-0 h-0 border-l-3 border-l-transparent border-r-3 border-r-transparent border-b-4 border-b-blue-400" />
            <div className="bg-blue-400/20 text-blue-300 text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 border border-blue-400/30 whitespace-nowrap">Batch Due</div>
          </div>

          <div className="absolute top-1/2 right-[5%] -translate-x-1/2 translate-y-3 flex flex-col items-center">
            <div className="w-0 h-0 border-l-3 border-l-transparent border-r-3 border-r-transparent border-b-4 border-b-red-400" />
            <div className="bg-red-400/20 text-red-300 text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 border border-red-400/30 whitespace-nowrap">Die Change RD-12</div>
          </div>
        </div>
      </section>

      {/* STATUS STREAM */}
      <section className="flex-1 p-4 space-y-3">
        <h2 className="text-xs font-bold tracking-widest text-neutral-500 uppercase mb-4">Action Stream</h2>

        {/* Priority 1: High alert, takes full width and bold styling */}
        <Card className="bg-red-950/40 border-red-900/50 shadow-none overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
          <CardContent className="p-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-red-400 font-bold mb-1">Behind Pace: 12 Cases</h3>
              <p className="text-sm text-red-200/70 mb-3">Running at 4.2 PPM. You need 4.8 PPM to finish on time.</p>
              <div className="flex items-center gap-4 text-xs font-medium">
                <div className="flex items-center gap-1.5 text-neutral-300">
                  <Timer className="w-3.5 h-3.5 text-amber-500" />
                  <span>Downtime: 6m 40s</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Priority 2: Status row */}
        <Card className="bg-blue-950/20 border-blue-900/30 shadow-none">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
              <Snowflake className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 flex justify-between items-center">
              <div>
                <h3 className="text-blue-300 font-semibold text-sm">Freezer Filling</h3>
                <p className="text-xs text-blue-200/60">First cases exit in 07:12 (35m tunnel)</p>
              </div>
              <div className="text-right">
                <div className="text-blue-400 font-mono font-bold">07:12</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Priority 3: Warning row */}
        <Card className="bg-amber-950/20 border-amber-900/30 shadow-none">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <Settings2 className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 flex justify-between items-center">
              <div>
                <h3 className="text-amber-300 font-semibold text-sm">Die Change Required Next</h3>
                <p className="text-xs text-amber-200/60">TX-16 → RD-12</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Priority 4: Action row */}
        <Card className="bg-emerald-950/20 border-emerald-900/30 shadow-none">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 animate-pulse">
              <Info className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-emerald-300 font-semibold text-sm">Start next dough batch now</h3>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20">Acknowledge</Button>
          </CardContent>
        </Card>

        <div className="pt-6 space-y-4">
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/30">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-neutral-800/50 transition-colors">
              <span className="font-semibold text-sm text-neutral-300">Run Details</span>
              {detailsOpen ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-4 pt-0 grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Cases Left to Run</div>
                  <div className="font-mono font-medium text-white">536</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Approx. Cases on Line</div>
                  <div className="font-mono font-medium text-white">27</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Dough Status</div>
                  <div className="font-medium text-emerald-400">+3.5 cases ahead</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Cases on Last Skid</div>
                  <div className="font-mono font-medium text-white">14</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Trays / Skid</div>
                  <div className="font-mono font-medium text-white">6.25</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Trays / Batch</div>
                  <div className="font-mono font-medium text-white">4.10</div>
                </div>
                <div className="space-y-1">
                  <div className="text-neutral-500 text-xs uppercase tracking-wider">Batches / Skid</div>
                  <div className="font-mono font-medium text-white">1.52</div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={adjustmentsOpen} onOpenChange={setAdjustmentsOpen} className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/30">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-neutral-800/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-neutral-300">Temporary Adjustments</span>
                <Badge variant="secondary" className="bg-amber-500/20 text-amber-300 border-none text-[10px] h-5 px-1.5">Override active</Badge>
              </div>
              {adjustmentsOpen ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-4 pt-0 space-y-4">
                <div className="flex items-center justify-between bg-neutral-950 p-2 rounded border border-neutral-800">
                  <span className="text-sm text-neutral-400">Freezer Time</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white">35m</span>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-neutral-950 p-2 rounded border border-neutral-800">
                  <span className="text-sm text-neutral-400">Crusts / Cycle</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-amber-400 font-bold">14</span>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-neutral-950 p-2 rounded border border-neutral-800">
                  <span className="text-sm text-neutral-400">Cycle Speed</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-amber-400 font-bold">1.2s</span>
                  </div>
                </div>
                <div className="flex justify-end mt-2">
                  <Button variant="ghost" size="sm" className="text-neutral-400 hover:text-white h-8 text-xs">Clear Adjustments</Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

      </section>
    </div>
  );
}
