import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useStore, EnvelopeNode } from '../store/useStore';
import { cn } from '../lib/utils';

export const EnvelopeEditor: React.FC = () => {
  const { 
    tracks, 
    zoom, 
    envelopeLocked, 
    selectedTrackId,
    addEnvelopeNode, 
    updateEnvelopeNode, 
    removeEnvelopeNode 
  } = useStore();
  
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [tracksOffsetTop, setTracksOffsetTop] = useState(0);
  const [draggingNode, setDraggingNode] = useState<{ trackId: string, nodeId: string } | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const lastTapTime = useRef<{ [key: string]: number }>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = document.querySelector('.multitrack-container');
    if (!container) return;

    let scrollContainer: HTMLElement | null = null;
    
    const updateScroll = () => {
      if (scrollContainer) {
        setScrollLeft(scrollContainer.scrollLeft);
        setScrollTop(scrollContainer.scrollTop);
      }
      
      const rect = container.getBoundingClientRect();
      let offsetTop = 0;
      const firstChild = container.firstChild;
      if (firstChild instanceof HTMLElement && firstChild.shadowRoot) {
        const canvases = firstChild.shadowRoot.querySelector('.canvases');
        if (canvases) {
          const canvasesRect = canvases.getBoundingClientRect();
          offsetTop = canvasesRect.top - rect.top;
        }
      }
      setTracksOffsetTop(offsetTop);
    };

    const setupListener = () => {
      const firstChild = container.firstChild;
      if (firstChild instanceof HTMLElement && firstChild.shadowRoot) {
        scrollContainer = firstChild.shadowRoot.querySelector('.scroll') as HTMLElement;
        if (scrollContainer) {
          scrollContainer.addEventListener('scroll', updateScroll);
          updateScroll();
        }
      }
    };

    setupListener();
    // Also poll occasionally for layout changes that don't trigger scroll
    const interval = setInterval(updateScroll, 500);

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', updateScroll);
      }
      clearInterval(interval);
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, trackId: string, node?: EnvelopeNode) => {
    if (envelopeLocked) return;
    e.stopPropagation();
    
    if (node) {
      const now = Date.now();
      const lastTap = lastTapTime.current[node.id] || 0;
      
      if (now - lastTap < 300) {
        // Double tap to delete
        removeEnvelopeNode(trackId, node.id);
        setDraggingNode(null);
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        return;
      }
      
      lastTapTime.current[node.id] = now;
      setDraggingNode({ trackId, nodeId: node.id });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      
      // Setup long press for mobile deletion
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        if (window.confirm('Delete this envelope node?')) {
          removeEnvelopeNode(trackId, node.id);
          setDraggingNode(null);
        }
      }, 600);
    } else {
      // Add new node
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const h = rect.height;
      const time = (x + scrollLeft) / zoom;
      const value = Math.max(0, Math.min(1, 1 - (y / h)));
      const newNodeId = Math.random().toString(36).substr(2, 9);
      addEnvelopeNode(trackId, { id: newNodeId, time, value });
      // Start dragging the new node immediately
      setDraggingNode({ trackId, nodeId: newNodeId });
      // We don't have the circle element here to set capture, 
      // but the move handler is now on the container, so it should work.
    }
  }, [envelopeLocked, removeEnvelopeNode, setDraggingNode, scrollLeft, zoom, addEnvelopeNode]);

  const handlePointerMove = (e: React.PointerEvent, trackId: string) => {
    if (envelopeLocked || !draggingNode || draggingNode.trackId !== trackId) return;
    
    // If we move significantly, cancel the long press
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // We need the track rect to calculate relative coordinates
    // Since we captured the pointer on the node (circle), e.currentTarget is the circle.
    // We need the track div. We can find it by climbing up or using a ref, 
    // but here we can just find the track element by ID or class.
    const trackEl = document.querySelector(`[data-track-id="${trackId}"]`);
    if (!trackEl) return;

    const rect = trackEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const h = rect.height;
    
    // Drag to delete logic: if dragged more than 60px above or below the track bounds
    if (y < -60 || y > h + 60) {
      removeEnvelopeNode(trackId, draggingNode.nodeId);
      setDraggingNode(null);
      return;
    }

    const time = Math.max(0, (x + scrollLeft) / zoom);
    const value = Math.max(0, Math.min(1, 1 - (y / h)));
    
    updateEnvelopeNode(trackId, draggingNode.nodeId, { time, value });
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setDraggingNode(null);
  };

  const handleContextMenu = (e: React.MouseEvent, trackId: string, nodeId: string) => {
    if (envelopeLocked) return;
    e.preventDefault();
    removeEnvelopeNode(trackId, nodeId);
  };

  return (
    <div 
      className="absolute inset-0 pointer-events-none z-30 overflow-hidden" 
      ref={containerRef}
      onPointerMove={(e) => {
        if (draggingNode) {
          handlePointerMove(e, draggingNode.trackId);
        }
      }}
      onPointerUp={handlePointerUp}
    >
      <div 
        className="flex flex-col"
        style={{ transform: `translateY(${tracksOffsetTop - scrollTop}px)` }}
      >
        {(tracks || []).map((track) => {
          const isExpanded = track.id === selectedTrackId && !envelopeLocked;
          const hVar = isExpanded ? 'var(--expanded-track-h, 80px)' : 'var(--normal-track-h, 50px)';
          
          return (
            <div 
              key={track.id}
              data-track-id={track.id}
              className={cn(
                "relative w-full overflow-hidden",
                !envelopeLocked ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"
              )}
              style={{ height: hVar }}
              onPointerDown={(e) => handlePointerDown(e, track.id)}
            >
              <svg className="absolute inset-0 w-full h-full overflow-visible">
                {/* Draw lines between nodes */}
                {track.envelope.length > 0 && (() => {
                  const rootStyle = getComputedStyle(document.documentElement);
                  const expandedH = parseInt(rootStyle.getPropertyValue('--expanded-track-h')) || 80;
                  const normalH = parseInt(rootStyle.getPropertyValue('--normal-track-h')) || 50;
                  const h = isExpanded ? expandedH : normalH;
                  
                  const sortedNodes = [...track.envelope].sort((a, b) => a.time - b.time);
                  const firstNode = sortedNodes[0];
                  const lastNode = sortedNodes[sortedNodes.length - 1];
                  
                  return (
                    <>
                      {/* Line from start to first node */}
                      <line
                        x1={-scrollLeft}
                        y1={(1 - firstNode.value) * h}
                        x2={(firstNode.time * zoom) - scrollLeft}
                        y2={(1 - firstNode.value) * h}
                        stroke={track.color}
                        strokeWidth="2"
                        strokeOpacity={envelopeLocked ? "0.3" : "0.8"}
                        strokeDasharray="4 2"
                      />
                      
                      {/* Lines between nodes */}
                      {sortedNodes.length > 1 && (
                        <polyline
                          points={sortedNodes.map(n => {
                            return `${(n.time * zoom) - scrollLeft},${(1 - n.value) * h}`;
                          }).join(' ')}
                          fill="none"
                          stroke={track.color}
                          strokeWidth="2"
                          strokeOpacity={envelopeLocked ? "0.3" : "0.8"}
                          className="pointer-events-none"
                        />
                      )}
                      
                      {/* Line from last node to end */}
                      <line
                        x1={(lastNode.time * zoom) - scrollLeft}
                        y1={(1 - lastNode.value) * h}
                        x2={10000} // Far enough to the right
                        y2={(1 - lastNode.value) * h}
                        stroke={track.color}
                        strokeWidth="2"
                        strokeOpacity={envelopeLocked ? "0.3" : "0.8"}
                        strokeDasharray="4 2"
                      />
                    </>
                  );
                })()}
                
                {/* Draw nodes */}
                {track.envelope.map(node => {
                  const rootStyle = getComputedStyle(document.documentElement);
                  const expandedH = parseInt(rootStyle.getPropertyValue('--expanded-track-h')) || 80;
                  const normalH = parseInt(rootStyle.getPropertyValue('--normal-track-h')) || 50;
                  const h = isExpanded ? expandedH : normalH;
                  return (
                    <circle
                      key={node.id}
                      cx={(node.time * zoom) - scrollLeft}
                      cy={(1 - node.value) * h}
                      r={envelopeLocked ? "2" : (draggingNode?.nodeId === node.id ? "6" : "4")}
                      fill={track.color}
                      stroke="white"
                      strokeWidth={envelopeLocked ? "0.5" : "1.5"}
                      className={cn(
                        "transition-all",
                        !envelopeLocked ? "cursor-grab active:cursor-grabbing pointer-events-auto hover:r-6" : "pointer-events-none"
                      )}
                      onPointerDown={(e) => handlePointerDown(e, track.id, node)}
                      onContextMenu={(e) => handleContextMenu(e, track.id, node.id)}
                    />
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
};
