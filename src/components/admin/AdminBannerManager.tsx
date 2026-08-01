// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { AnimatedIconPickerInline } from '@/components/admin/AnimatedIconPickerInline';
import { AnimatedCategoryIcon, isAnimatedIcon } from '@/components/icons/AnimatedCategoryIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveProducts } from '@/lib/bannerProductResolver';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, GripVertical, Eye, Megaphone, Globe, Building2, Timer, Sparkles, Image, PartyPopper, X, ChevronUp, ChevronDown, Copy, ChevronLeft, ChevronRight, Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { BannerImageUpload } from './BannerImageUpload';

type BannerTemplate = 'image_only' | 'text_overlay' | 'split_left' | 'gradient_cta' | 'minimal_text';

const TEMPLATES: { value: BannerTemplate; label: string; description: string }[] = [
  { value: 'image_only', label: 'Image Only', description: 'Full-width image banner' },
  { value: 'text_overlay', label: 'Text Overlay', description: 'Image with text overlay & CTA' },
  { value: 'split_left', label: 'Split Layout', description: 'Text left, image right' },
  { value: 'gradient_cta', label: 'Gradient CTA', description: 'Gradient background with bold CTA' },
  { value: 'minimal_text', label: 'Minimal Text', description: 'Clean text-only announcement' },
];

const DEFAULT_COLORS = [
  '#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c',
  '#0d9488', '#4f46e5', '#be185d', '#1e293b', '#854d0e',
];

const ANIMATION_TYPES = [
  { value: 'none', label: '⛔ None', group: 'Basic' },
  { value: 'sparkle', label: '✨ Sparkle', group: 'Light & Glow' },
  { value: 'glow', label: '🌟 Glow', group: 'Light & Glow' },
  { value: 'shimmer', label: '💫 Shimmer', group: 'Light & Glow' },
  { value: 'twinkle', label: '⭐ Twinkle', group: 'Light & Glow' },
  { value: 'glitter', label: '✦ Glitter', group: 'Light & Glow' },
  { value: 'starburst', label: '💥 Starburst', group: 'Light & Glow' },
  { value: 'northern_lights', label: '🌌 Northern Lights', group: 'Light & Glow' },
  { value: 'neon_glow', label: '💡 Neon Glow', group: 'Light & Glow' },
  { value: 'firefly', label: '🔥 Firefly', group: 'Light & Glow' },
  { value: 'candlelight', label: '🕯️ Candlelight', group: 'Light & Glow' },
  { value: 'diya_flame', label: '🪔 Diya Flame', group: 'Light & Glow' },
  { value: 'lantern_sway', label: '🏮 Lantern Sway', group: 'Light & Glow' },
  { value: 'fairy_lights', label: '🧚 Fairy Lights', group: 'Light & Glow' },
  { value: 'spotlight', label: '🔦 Spotlight', group: 'Light & Glow' },
  { value: 'confetti', label: '🎊 Confetti', group: 'Particle & Burst' },
  { value: 'fireworks', label: '🎆 Fireworks', group: 'Particle & Burst' },
  { value: 'firecrackers', label: '🧨 Firecrackers', group: 'Particle & Burst' },
  { value: 'color_burst', label: '🎨 Color Burst', group: 'Particle & Burst' },
  { value: 'gulal_splash', label: '🟡 Gulal Splash', group: 'Particle & Burst' },
  { value: 'pichkari_spray', label: '💦 Pichkari Spray', group: 'Particle & Burst' },
  { value: 'balloon_pop', label: '🎈 Balloon Pop', group: 'Particle & Burst' },
  { value: 'bubble_float', label: '🫧 Bubble Float', group: 'Particle & Burst' },
  { value: 'snow_fall', label: '❄️ Snowfall', group: 'Particle & Burst' },
  { value: 'rain_drops', label: '🌧️ Rain Drops', group: 'Particle & Burst' },
  { value: 'petal_shower', label: '🌸 Petal Shower', group: 'Particle & Burst' },
  { value: 'leaf_fall', label: '🍂 Leaf Fall', group: 'Particle & Burst' },
  { value: 'dust_motes', label: '🌫️ Dust Motes', group: 'Particle & Burst' },
  { value: 'pulse', label: '💗 Pulse', group: 'Motion & Flow' },
  { value: 'wave', label: '🌊 Wave', group: 'Motion & Flow' },
  { value: 'ripple', label: '💧 Ripple', group: 'Motion & Flow' },
  { value: 'bounce', label: '⬆️ Bounce', group: 'Motion & Flow' },
  { value: 'float', label: '🎐 Float', group: 'Motion & Flow' },
  { value: 'swing', label: '🎠 Swing', group: 'Motion & Flow' },
  { value: 'spin', label: '🔄 Spin', group: 'Motion & Flow' },
  { value: 'wobble', label: '〰️ Wobble', group: 'Motion & Flow' },
  { value: 'shake', label: '📳 Shake', group: 'Motion & Flow' },
  { value: 'breathe', label: '🫁 Breathe', group: 'Motion & Flow' },
  { value: 'orbit', label: '🪐 Orbit', group: 'Motion & Flow' },
  { value: 'pendulum', label: '⏰ Pendulum', group: 'Motion & Flow' },
  { value: 'zigzag', label: '⚡ Zigzag', group: 'Motion & Flow' },
  { value: 'spiral', label: '🌀 Spiral', group: 'Motion & Flow' },
  { value: 'fade_slide', label: '📤 Fade Slide', group: 'Transition & Reveal' },
  { value: 'zoom_in', label: '🔍 Zoom In', group: 'Transition & Reveal' },
  { value: 'slide_up', label: '⬆️ Slide Up', group: 'Transition & Reveal' },
  { value: 'curtain_reveal', label: '🎭 Curtain Reveal', group: 'Transition & Reveal' },
  { value: 'flip', label: '🔃 Flip', group: 'Transition & Reveal' },
  { value: 'morph', label: '🫠 Morph', group: 'Transition & Reveal' },
  { value: 'typewriter', label: '⌨️ Typewriter', group: 'Transition & Reveal' },
  { value: 'blur_reveal', label: '🔲 Blur Reveal', group: 'Transition & Reveal' },
  { value: 'dissolve', label: '🌬️ Dissolve', group: 'Transition & Reveal' },
  { value: 'rangoli_draw', label: '🎨 Rangoli Draw', group: 'Cultural & Festival' },
  { value: 'toran_sway', label: '🪷 Toran Sway', group: 'Cultural & Festival' },
  { value: 'aarti_glow', label: '🙏 Aarti Glow', group: 'Cultural & Festival' },
  { value: 'dhol_beat', label: '🥁 Dhol Beat', group: 'Cultural & Festival' },
  { value: 'bell_ring', label: '🔔 Bell Ring', group: 'Cultural & Festival' },
  { value: 'crescent_moon', label: '🌙 Crescent Moon', group: 'Cultural & Festival' },
  { value: 'star_trail', label: '🌠 Star Trail', group: 'Cultural & Festival' },
  { value: 'peacock_fan', label: '🦚 Peacock Fan', group: 'Cultural & Festival' },
  { value: 'lotus_bloom', label: '🪷 Lotus Bloom', group: 'Cultural & Festival' },
  { value: 'coconut_break', label: '🥥 Coconut Break', group: 'Cultural & Festival' },
  { value: 'mango_leaf', label: '🥭 Mango Leaf', group: 'Cultural & Festival' },
  { value: 'kolam_trace', label: '⚪ Kolam Trace', group: 'Cultural & Festival' },
  { value: 'garland_drape', label: '💐 Garland Drape', group: 'Cultural & Festival' },
  { value: 'kite_fly', label: '🪁 Kite Fly', group: 'Cultural & Festival' },
  { value: 'dandiya_spin', label: '🕺 Dandiya Spin', group: 'Cultural & Festival' },
  { value: 'flame_flicker', label: '🔥 Flame Flicker', group: 'Regional & Tribal' },
  { value: 'waterfall', label: '💧 Waterfall', group: 'Regional & Tribal' },
  { value: 'holy_water', label: '🌊 Holy Water', group: 'Regional & Tribal' },
  { value: 'sunrise', label: '🌅 Sunrise', group: 'Regional & Tribal' },
  { value: 'moonrise', label: '🌕 Moonrise', group: 'Regional & Tribal' },
  { value: 'harvest_wave', label: '🌾 Harvest Wave', group: 'Regional & Tribal' },
  { value: 'tribal_drum', label: '🪘 Tribal Drum', group: 'Regional & Tribal' },
  { value: 'folk_dance', label: '💃 Folk Dance', group: 'Regional & Tribal' },
  { value: 'bhangra_bounce', label: '🕺 Bhangra Bounce', group: 'Regional & Tribal' },
  { value: 'jungle_vines', label: '🌿 Jungle Vines', group: 'Regional & Tribal' },
  { value: 'bamboo_sway', label: '🎋 Bamboo Sway', group: 'Regional & Tribal' },
  { value: 'bonfire', label: '🔥 Bonfire', group: 'Regional & Tribal' },
  { value: 'desert_wind', label: '🏜️ Desert Wind', group: 'Regional & Tribal' },
  { value: 'snake_coil', label: '🐍 Snake Coil', group: 'Regional & Tribal' },
  { value: 'mask_dance', label: '🎭 Mask Dance', group: 'Regional & Tribal' },
  { value: 'sound_wave', label: '🎵 Sound Wave', group: 'Regional & Tribal' },
  { value: 'heartbeat', label: '💓 Heartbeat', group: 'Regional & Tribal' },
  { value: 'purification', label: '✨ Purification', group: 'Regional & Tribal' },
  { value: 'gold_coins', label: '💰 Gold Coins', group: 'Regional & Tribal' },
];

const INTENSITY_OPTIONS = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'medium', label: 'Medium' },
  { value: 'rich', label: 'Rich' },
];

const WIZARD_STEPS = [
  { key: 'type', label: 'Type & Theme', icon: Sparkles },
  { key: 'content', label: 'Content', icon: Pencil },
  { key: 'targeting', label: 'Targeting & Schedule', icon: Globe },
  { key: 'review', label: 'Review & Publish', icon: Check },
];

const ICON_COLOR_PALETTE = [
  { label: 'Purple', hex: '#A78BFA' },
  { label: 'Amber', hex: '#FBBF24' },
  { label: 'Emerald', hex: '#34D399' },
  { label: 'Rose', hex: '#FB7185' },
  { label: 'Sky', hex: '#38BDF8' },
  { label: 'Orange', hex: '#FB923C' },
  { label: 'Teal', hex: '#2DD4BF' },
  { label: 'Pink', hex: '#F472B6' },
];

interface SectionForm {
  id?: string;
  title: string;
  icon_emoji: string;
  icon_color?: string | null;
  product_source_type: 'category' | 'search' | 'manual';
  product_source_value: string;
}

interface BannerForm {
  banner_type: 'classic' | 'festival';
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string;
  button_text: string;
  bg_color: string;
  template: BannerTemplate;
  is_active: boolean;
  display_order: number;
  target_society_ids: string[];
  auto_rotate_seconds: number;
  theme_preset: string;
  theme_config: any;
  animation_config: { type: string; intensity: string };
  badge_text: string;
  schedule_start: string;
  schedule_end: string;
  fallback_mode: 'hide' | 'popular';
  sections: SectionForm[];
  cta_action: 'link' | 'collection' | 'category';
  cta_target: string;
}

const emptyForm: BannerForm = {
  banner_type: 'classic',
  title: '', subtitle: '', image_url: '', link_url: '', button_text: '',
  bg_color: '#16a34a', template: 'image_only', is_active: true, display_order: 0,
  target_society_ids: [], auto_rotate_seconds: 4,
  theme_preset: '', theme_config: {}, animation_config: { type: 'none', intensity: 'subtle' },
  badge_text: '', schedule_start: '', schedule_end: '', fallback_mode: 'hide',
  sections: [],
  cta_action: 'link', cta_target: '',
};

export function AdminBannerManager() {
  const { effectiveSocietyId } = useAuth();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BannerForm>(emptyForm);
  const [presetSearch, setPresetSearch] = useState('');
  const [titleFocused, setTitleFocused] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [societySearch, setSocietySearch] = useState('');

  const { data: presets = [] } = useQuery({
    queryKey: ['banner-theme-presets'],
    queryFn: async () => {
      const { data } = await supabase.from('banner_theme_presets').select('*').eq('is_active', true).order('label');
      return data || [];
    },
    staleTime: 24 * 60 * 60_000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['category-config-list'],
    queryFn: async () => {
      const { data } = await supabase.from('category_config').select('category, display_name').eq('is_active', true).order('display_name');
      return data || [];
    },
    staleTime: 60_000,
  });

  // Fetch societies with builder info for smart targeting
  const { data: allSocieties = [] } = useQuery({
    queryKey: ['societies-list-with-builders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('societies')
        .select('id, name, builder_id, builders:builder_id(id, name)')
        .eq('is_active', true)
        .order('name');
      return (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        builder_id: s.builder_id,
        builder_name: s.builders?.name || null,
      }));
    },
    staleTime: 5 * 60_000,
  });

  // Group societies by builder for smart targeting
  const societiesByBuilder = useMemo(() => {
    const groups: Record<string, { builder_name: string; builder_id: string; societies: typeof allSocieties }> = {};
    const ungrouped: typeof allSocieties = [];
    for (const s of allSocieties) {
      if (s.builder_id && s.builder_name) {
        if (!groups[s.builder_id]) {
          groups[s.builder_id] = { builder_name: s.builder_name, builder_id: s.builder_id, societies: [] };
        }
        groups[s.builder_id].societies.push(s);
      } else {
        ungrouped.push(s);
      }
    }
    return { groups: Object.values(groups), ungrouped };
  }, [allSocieties]);

  // Filter societies by search
  const filteredSocieties = useMemo(() => {
    if (!societySearch.trim()) return allSocieties;
    const q = societySearch.toLowerCase();
    return allSocieties.filter(s => s.name.toLowerCase().includes(q) || (s.builder_name || '').toLowerCase().includes(q));
  }, [allSocieties, societySearch]);

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['admin-banners', effectiveSocietyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('featured_items')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (f: BannerForm) => {
      const payload: any = {
        title: f.title || null,
        subtitle: f.subtitle || null,
        image_url: f.image_url || null,
        link_url: f.link_url || null,
        button_text: f.button_text || null,
        bg_color: f.bg_color,
        template: f.template,
        is_active: f.is_active,
        display_order: f.display_order,
        type: 'banner',
        reference_id: 'banner',
        target_society_ids: f.target_society_ids,
        society_id: f.target_society_ids.length === 1 ? f.target_society_ids[0] : null,
        auto_rotate_seconds: f.auto_rotate_seconds,
        banner_type: f.banner_type,
        theme_preset: f.theme_preset || null,
        theme_config: f.theme_config || {},
        animation_config: f.animation_config || { type: 'none', intensity: 'subtle' },
        badge_text: f.badge_text || null,
        schedule_start: f.schedule_start || null,
        schedule_end: f.schedule_end || null,
        fallback_mode: f.fallback_mode,
        cta_config: f.banner_type === 'classic'
          ? { action: f.cta_action || 'link', target: f.cta_target || f.link_url || '' }
          : { action: 'link' },
      };

      let bannerId: string;

      if (editingId) {
        const { error } = await supabase.from('featured_items').update(payload).eq('id', editingId);
        if (error) throw error;
        bannerId = editingId;
        if (f.banner_type === 'festival') {
          await supabase.from('banner_sections').delete().eq('banner_id', bannerId);
        }
      } else {
        const { data, error } = await supabase.from('featured_items').insert(payload).select('id').single();
        if (error) throw error;
        bannerId = data.id;
      }

      if (f.banner_type === 'festival' && f.sections.length > 0) {
        const sectionRows = f.sections.map((s, idx) => ({
          banner_id: bannerId,
          title: s.title,
          icon_emoji: s.icon_emoji || null,
          icon_color: s.icon_color || null,
          display_order: idx,
          product_source_type: s.product_source_type,
          product_source_value: s.product_source_value || null,
        }));
        const { error: secErr } = await supabase.from('banner_sections').insert(sectionRows);
        if (secErr) throw secErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-banners'] });
      qc.invalidateQueries({ queryKey: ['featured-banners'] });
      qc.invalidateQueries({ queryKey: ['banner-sections'] });
      toast.success(editingId ? 'Banner updated' : 'Banner created');
      closeSheet();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('banner_sections').delete().eq('banner_id', id);
      const { error } = await supabase.from('featured_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-banners'] });
      qc.invalidateQueries({ queryKey: ['featured-banners'] });
      qc.invalidateQueries({ queryKey: ['banner-sections'] });
      toast.success('Banner deleted');
    },
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDuplicate = async (banner: any) => {
    const payload: any = {
      title: `${banner.title || 'Banner'} (Copy)`,
      subtitle: banner.subtitle,
      image_url: banner.image_url,
      link_url: banner.link_url,
      button_text: banner.button_text,
      bg_color: banner.bg_color,
      template: banner.template,
      is_active: false,
      display_order: banners.length,
      type: 'banner',
      reference_id: 'banner',
      target_society_ids: banner.target_society_ids || [],
      auto_rotate_seconds: banner.auto_rotate_seconds || 4,
      banner_type: banner.banner_type || 'classic',
      theme_preset: banner.theme_preset,
      theme_config: banner.theme_config || {},
      animation_config: banner.animation_config || { type: 'none', intensity: 'subtle' },
      badge_text: banner.badge_text,
      schedule_start: null,
      schedule_end: null,
      fallback_mode: banner.fallback_mode || 'hide',
      cta_config: banner.cta_config || { action: 'link' },
      status: 'draft',
    };

    const { data, error } = await supabase.from('featured_items').insert(payload).select('id').single();
    if (error) { toast.error(error.message); return; }

    if (banner.banner_type === 'festival') {
      const { data: sections } = await supabase.from('banner_sections').select('*').eq('banner_id', banner.id).order('display_order');
      if (sections && sections.length > 0) {
        const sectionRows = sections.map((s: any) => ({
          banner_id: data.id,
          title: s.title,
          icon_emoji: s.icon_emoji,
          icon_color: s.icon_color || null,
          display_order: s.display_order,
          product_source_type: s.product_source_type,
          product_source_value: s.product_source_value,
        }));
        await supabase.from('banner_sections').insert(sectionRows);
      }
    }

    qc.invalidateQueries({ queryKey: ['admin-banners'] });
    toast.success('Banner duplicated as draft');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, display_order: banners.length });
    setWizardStep(0);
    setSheetOpen(true);
  };

  const openEdit = async (banner: any) => {
    setEditingId(banner.id);

    let sections: SectionForm[] = [];
    if (banner.banner_type === 'festival') {
      const { data } = await supabase.from('banner_sections').select('*').eq('banner_id', banner.id).order('display_order');
      sections = (data || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        icon_emoji: s.icon_emoji || '📦',
        icon_color: s.icon_color || null,
        product_source_type: s.product_source_type,
        product_source_value: s.product_source_value || '',
      }));
    }

    const ctaConfig = banner.cta_config || {};
    setForm({
      banner_type: banner.banner_type || 'classic',
      title: banner.title || '',
      subtitle: banner.subtitle || '',
      image_url: banner.image_url || '',
      link_url: banner.link_url || '',
      button_text: banner.button_text || '',
      bg_color: banner.bg_color || '#16a34a',
      template: banner.template || 'image_only',
      is_active: banner.is_active ?? true,
      display_order: banner.display_order ?? 0,
      target_society_ids: banner.target_society_ids || (banner.society_id ? [banner.society_id] : []),
      auto_rotate_seconds: banner.auto_rotate_seconds ?? 4,
      theme_preset: banner.theme_preset || '',
      theme_config: banner.theme_config || {},
      animation_config: banner.animation_config || { type: 'none', intensity: 'subtle' },
      badge_text: banner.badge_text || '',
      schedule_start: banner.schedule_start ? banner.schedule_start.slice(0, 16) : '',
      schedule_end: banner.schedule_end ? banner.schedule_end.slice(0, 16) : '',
      fallback_mode: banner.fallback_mode || 'hide',
      sections,
      cta_action: ctaConfig.action || 'link',
      cta_target: ctaConfig.target || '',
    });
    setWizardStep(0);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setWizardStep(0);
  };

  const updateField = <K extends keyof BannerForm>(key: K, value: BannerForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const applyPreset = (presetKey: string) => {
    const preset = presets.find((p: any) => p.preset_key === presetKey);
    if (!preset) return;
    const suggested = (preset as any).suggested_sections || [];
    const themeTags = suggested.map((s: any) => s.title).filter(Boolean);
    setForm(prev => ({
      ...prev,
      theme_preset: presetKey,
      theme_config: { ...((preset as any).colors || {}), theme_tags: themeTags },
      animation_config: (preset as any).animation_defaults || { type: 'none', intensity: 'subtle' },
      title: prev.title || `Celebrate ${(preset as any).label}`,
      subtitle: prev.subtitle || `Everything you need for ${(preset as any).label}`,
      badge_text: `${(preset as any).icon_emoji || '🎉'} ${(preset as any).label}`,
      sections: suggested.map((s: any) => ({
        title: s.title,
        icon_emoji: s.icon_emoji || s.emoji || '📦',
        product_source_type: s.product_source_type || s.source_type || 'category',
        product_source_value: s.product_source_value || s.source_value || '',
      })),
    }));
  };

  const addSection = () => {
    setForm(prev => ({
      ...prev,
      sections: [...prev.sections, { title: '', icon_emoji: '📦', icon_color: null, product_source_type: 'category', product_source_value: '' }],
    }));
  };

  const updateSection = (idx: number, field: keyof SectionForm, value: string) => {
    setForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));
  };

  const removeSection = (idx: number) => {
    setForm(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== idx),
    }));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= form.sections.length) return;
    setForm(prev => {
      const arr = [...prev.sections];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...prev, sections: arr };
    });
  };

  const toggleBuilderSocieties = (builderId: string) => {
    const group = societiesByBuilder.groups.find(g => g.builder_id === builderId);
    if (!group) return;
    const groupIds = group.societies.map(s => s.id);
    const allSelected = groupIds.every(id => form.target_society_ids.includes(id));
    if (allSelected) {
      updateField('target_society_ids', form.target_society_ids.filter(id => !groupIds.includes(id)));
    } else {
      const merged = [...new Set([...form.target_society_ids, ...groupIds])];
      updateField('target_society_ids', merged);
    }
  };

  const [isValidating, setIsValidating] = useState(false);

  const handleSave = async () => {
    if (form.banner_type === 'festival' && form.sections.length === 0) {
      toast.error('Festival banners need at least one section');
      return;
    }
    if (form.banner_type === 'festival') {
      const empty = form.sections.filter(s => !s.title.trim());
      if (empty.length > 0) {
        toast.error('All sections need a title');
        return;
      }

      setIsValidating(true);
      try {
        let emptyCount = 0;
        for (const section of form.sections) {
          const products = await resolveProducts({
            sourceType: section.product_source_type,
            sourceValue: section.product_source_value || null,
            fallbackMode: form.fallback_mode,
            limit: 1,
          });
          if (products.length === 0) {
            emptyCount++;
            toast.warning(`Section "${section.title}" has no matching products yet`);
          }
        }
        if (emptyCount > 0 && emptyCount < form.sections.length) {
          toast.info('Some sections are empty — they will be hidden on the buyer side');
        } else if (emptyCount === form.sections.length) {
          toast.warning('All sections are currently empty — banner will be hidden until products are added');
        }
      } catch {
      } finally {
        setIsValidating(false);
      }
    }
    saveMutation.mutate(form);
  };

  const canGoNext = () => {
    if (wizardStep === 0) return true; // type always selected
    if (wizardStep === 1) {
      if (!form.title.trim()) return false;
      if (form.banner_type === 'festival' && form.sections.length === 0) return false;
      return true;
    }
    if (wizardStep === 2) return true;
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Megaphone size={15} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Featured Banners</h3>
            <p className="text-[10px] text-muted-foreground">{banners.length} banner{banners.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 rounded-xl font-semibold">
          <Plus size={13} /> Add Banner
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}</div>
      ) : banners.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Megaphone size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">No banners yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Create one to feature on the home page.</p>
          </CardContent>
        </Card>
      ) : (
        banners.map((b: any, idx: number) => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <Card className={cn('border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl', !b.is_active && 'opacity-50')}>
              <CardContent className="p-3.5 flex items-center gap-3">
                <GripVertical size={14} className="text-muted-foreground shrink-0" />
                {b.banner_type === 'festival' ? (
                  <div className="w-16 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg"
                    style={{ background: (b.theme_config?.gradient?.length >= 2) ? `linear-gradient(135deg, ${b.theme_config.gradient.join(', ')})` : (b.theme_config?.bg || '#16a34a') }}>
                    {(presets.find((p: any) => p.preset_key === b.theme_preset) as any)?.icon_emoji || '🎉'}
                  </div>
                ) : b.image_url ? (
                  <img src={b.image_url} alt="" className="w-16 h-10 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-10 rounded-xl shrink-0 flex items-center justify-center text-[10px] text-white font-bold" style={{ backgroundColor: b.bg_color || '#16a34a' }}>
                    {(b.template || 'text').toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{b.title || 'Untitled'}</p>
                    {b.banner_type === 'festival' && <Badge className="text-[9px] h-4 px-1.5 bg-amber-500/10 text-amber-600 border-0 shrink-0">Festival</Badge>}
                    {b.status === 'draft' && <Badge className="text-[9px] h-4 px-1.5 bg-muted text-muted-foreground border-0 shrink-0">Draft</Badge>}
                    {b.status === 'archived' && <Badge className="text-[9px] h-4 px-1.5 bg-muted text-muted-foreground border-0 shrink-0">Archived</Badge>}
                    {!b.society_id && b.target_society_ids?.length === 0 && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary shrink-0">Global</Badge>}
                    {b.schedule_end && new Date(b.schedule_end) < new Date() && (
                      <Badge className="text-[9px] h-4 px-1.5 bg-muted text-muted-foreground border-0 shrink-0">Ended</Badge>
                    )}
                    {b.schedule_start && new Date(b.schedule_start) > new Date() && (
                      <Badge className="text-[9px] h-4 px-1.5 bg-info/10 text-info border-0 shrink-0">Upcoming</Badge>
                    )}
                    {b.schedule_start && b.schedule_end && new Date(b.schedule_start) <= new Date() && new Date(b.schedule_end) >= new Date() && (
                      <Badge className="text-[9px] h-4 px-1.5 bg-success/10 text-success border-0 shrink-0">Active</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {b.banner_type === 'festival' ? `${b.theme_preset || 'custom'} theme` : (TEMPLATES.find(t => t.value === b.template)?.label || 'Image Only')} · Order: {b.display_order}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Switch
                    checked={b.is_active}
                    onCheckedChange={async (checked) => {
                      await supabase.from('featured_items').update({ is_active: checked, status: checked ? 'published' : 'archived' }).eq('id', b.id);
                      qc.invalidateQueries({ queryKey: ['admin-banners'] });
                      qc.invalidateQueries({ queryKey: ['featured-banners'] });
                    }}
                  />
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-xl" onClick={() => openEdit(b)}>
                    <Pencil size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-xl" onClick={() => handleDuplicate(b)} title="Duplicate">
                    <Copy size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-xl text-destructive hover:text-destructive" onClick={() => setDeleteConfirmId(b.id)}>
                    <Trash2 size={12} />
                  </Button>
                  {deleteConfirmId === b.id && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-3 flex flex-col gap-2 w-48">
                      <p className="text-xs font-semibold">Delete this banner?</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs rounded-lg" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                        <Button size="sm" variant="destructive" className="flex-1 h-7 text-xs rounded-lg" onClick={() => { deleteMutation.mutate(b.id); setDeleteConfirmId(null); }}>Delete</Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))
      )}

      {/* ── 4-Step Wizard Drawer ── */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[90vh] overflow-y-auto bg-background border-border">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="font-bold">{editingId ? 'Edit Banner' : 'Create Banner'}</DrawerTitle>
            {/* Step indicator */}
            <div className="flex items-center gap-1 mt-3">
              {WIZARD_STEPS.map((step, i) => {
                const StepIcon = step.icon;
                return (
                  <button
                    key={step.key}
                    onClick={() => setWizardStep(i)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
                      i === wizardStep
                        ? 'bg-primary text-primary-foreground'
                        : i < wizardStep
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <StepIcon size={12} />
                    <span className="hidden sm:inline">{step.label}</span>
                    <span className="sm:hidden">{i + 1}</span>
                  </button>
                );
              })}
            </div>
          </DrawerHeader>

          <div className="px-4 pb-6 space-y-5">
            {/* ═══ STEP 1: Type & Theme ═══ */}
            {wizardStep === 0 && (
              <>
                <div>
                  <Label className="text-xs font-bold mb-2 block uppercase tracking-wider text-muted-foreground">Banner Type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateField('banner_type', 'classic')}
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all',
                        form.banner_type === 'classic' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40'
                      )}
                    >
                      <Image size={18} className="text-primary mb-1" />
                      <p className="text-xs font-bold">Classic Banner</p>
                      <p className="text-[10px] text-muted-foreground">Static image/text with single CTA</p>
                    </button>
                    <button
                      onClick={() => updateField('banner_type', 'festival')}
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all',
                        form.banner_type === 'festival' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40'
                      )}
                    >
                      <PartyPopper size={18} className="text-amber-500 mb-1" />
                      <p className="text-xs font-bold">Festival Experience</p>
                      <p className="text-[10px] text-muted-foreground">Multi-section themed module</p>
                    </button>
                  </div>
                </div>

                {form.banner_type === 'festival' && (
                  <div>
                    <Label className="text-xs font-bold mb-2 block uppercase tracking-wider text-muted-foreground">
                      <Sparkles size={12} className="inline mr-1" /> Theme Preset ({presets.length} available)
                    </Label>
                    <input
                      type="text"
                      placeholder="Search festivals, items, themes…"
                      value={presetSearch}
                      onChange={(e) => setPresetSearch(e.target.value)}
                      className="w-full mb-2 px-3 py-2 rounded-xl border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="grid grid-cols-4 gap-2 max-h-[280px] overflow-y-auto pr-1">
                      {presets
                        .filter((p: any) => {
                          if (!presetSearch.trim()) return true;
                          const q = presetSearch.toLowerCase();
                          if (p.label?.toLowerCase().includes(q) || p.preset_key?.toLowerCase().includes(q)) return true;
                          const sections = p.suggested_sections || [];
                          return sections.some((s: any) => s.title?.toLowerCase().includes(q));
                        })
                        .map((preset: any) => (
                        <button
                          key={preset.preset_key}
                          onClick={() => { applyPreset(preset.preset_key); setPresetSearch(''); }}
                          className={cn(
                            'p-2 rounded-xl border text-center transition-all',
                            form.theme_preset === preset.preset_key ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40'
                          )}
                        >
                          <span className="text-xl block">{preset.icon_emoji}</span>
                          <p className="text-[10px] font-semibold mt-0.5 truncate">{preset.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {form.banner_type === 'classic' && (
                  <div>
                    <Label className="text-xs font-bold mb-2 block uppercase tracking-wider text-muted-foreground">Template</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {TEMPLATES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => updateField('template', t.value)}
                          className={cn(
                            'p-3 rounded-xl border text-left transition-all duration-200',
                            form.template === t.value
                              ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-sm'
                              : 'border-border hover:border-primary/40 hover:shadow-sm'
                          )}
                        >
                          <p className="text-xs font-bold">{t.label}</p>
                          <p className="text-[10px] text-muted-foreground">{t.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Animation Config (Festival) */}
                {form.banner_type === 'festival' && (
                  <div className="space-y-3 p-3 bg-muted/60 rounded-xl border border-border/50">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Animation</Label>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Type</Label>
                      <Select
                        value={form.animation_config.type}
                        onValueChange={v => updateField('animation_config', { ...form.animation_config, type: v })}
                      >
                        <SelectTrigger className="rounded-xl h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {(() => {
                            const groups = [...new Set(ANIMATION_TYPES.map(a => a.group))];
                            return groups.map(g => (
                              <div key={g}>
                                <p className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider sticky top-0 bg-popover">{g}</p>
                                {ANIMATION_TYPES.filter(a => a.group === g).map(a => (
                                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                ))}
                              </div>
                            ));
                          })()}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Intensity</Label>
                      <Select
                        value={form.animation_config.intensity}
                        onValueChange={v => updateField('animation_config', { ...form.animation_config, intensity: v })}
                      >
                        <SelectTrigger className="rounded-xl h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INTENSITY_OPTIONS.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Background Color */}
                {((form.banner_type === 'classic' && form.template !== 'image_only') || form.banner_type === 'festival') && (
                  <div>
                    <Label className="text-xs font-bold mb-2 block uppercase tracking-wider text-muted-foreground">Background Color</Label>
                    <div className="flex gap-2 flex-wrap">
                      {DEFAULT_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => {
                            updateField('bg_color', c);
                            if (form.banner_type === 'festival') {
                              updateField('theme_config', { ...form.theme_config, bg: c, gradient: [c, c + 'cc'] });
                            }
                          }}
                          className={cn(
                            'w-8 h-8 rounded-full border-2 transition-all duration-200',
                            form.bg_color === c ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ STEP 2: Content ═══ */}
            {wizardStep === 1 && (
              <>
                {/* Preview */}
                {form.banner_type === 'festival' && (
                  <div>
                    <Label className="text-xs font-bold mb-2 flex items-center gap-1 uppercase tracking-wider text-muted-foreground"><Eye size={12} /> Preview</Label>
                    <div className="rounded-2xl overflow-hidden border border-border/40 shadow-sm">
                      <FestivalPreview form={form} />
                    </div>
                  </div>
                )}
                {form.banner_type === 'classic' && (
                  <div>
                    <Label className="text-xs font-bold mb-2 flex items-center gap-1 uppercase tracking-wider text-muted-foreground"><Eye size={12} /> Preview</Label>
                    <div className="rounded-2xl overflow-hidden border border-border/40 shadow-sm">
                      <ClassicPreview form={form} />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="relative">
                    <Label className="text-xs font-semibold">Title</Label>
                    <Input value={form.title} onChange={e => updateField('title', e.target.value)} placeholder="Banner headline" className="rounded-xl" onFocus={() => setTitleFocused(true)} onBlur={() => setTimeout(() => setTitleFocused(false), 200)} />
                    {form.banner_type === 'festival' && titleFocused && form.title.length >= 2 && (() => {
                      const q = form.title.toLowerCase();
                      const matches = presets.filter((p: any) => {
                        if (p.label?.toLowerCase().includes(q)) return true;
                        const sections = p.suggested_sections || [];
                        return sections.some((s: any) => s.title?.toLowerCase().includes(q));
                      }).slice(0, 5);
                      if (matches.length === 0 || form.theme_preset) return null;
                      return (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
                          {matches.map((p: any) => (
                            <button
                              key={p.preset_key}
                              onClick={() => { applyPreset(p.preset_key); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors text-sm"
                            >
                              <span className="text-base">{p.icon_emoji}</span>
                              <span className="font-medium">{p.label}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">Apply preset</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <Label className="text-xs font-semibold">Subtitle</Label>
                    <Textarea value={form.subtitle} onChange={e => updateField('subtitle', e.target.value)} placeholder="Supporting text" rows={2} className="rounded-xl" />
                  </div>

                  {form.banner_type === 'festival' && (
                    <div>
                      <Label className="text-xs font-semibold">Badge Text (optional)</Label>
                      <Input value={form.badge_text} onChange={e => updateField('badge_text', e.target.value)} placeholder="e.g. Limited Time, Festival Special" className="rounded-xl" />
                    </div>
                  )}

                  {form.banner_type === 'festival' && (
                    <div>
                      <Label className="text-xs font-semibold">Theme Tags</Label>
                      <p className="text-[10px] text-muted-foreground mb-1">Tags for product discovery</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(form.theme_config?.theme_tags || []).map((tag: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="gap-1 text-xs">
                            {tag}
                            <button
                              onClick={() => {
                                const tags = [...(form.theme_config?.theme_tags || [])];
                                tags.splice(idx, 1);
                                updateField('theme_config', { ...form.theme_config, theme_tags: tags });
                              }}
                              className="ml-0.5 hover:text-destructive"
                            >
                              <X size={10} />
                            </button>
                          </Badge>
                        ))}
                      </div>
                      <Input
                        placeholder="Type tag and press Enter…"
                        className="rounded-xl"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val && !(form.theme_config?.theme_tags || []).includes(val)) {
                              updateField('theme_config', {
                                ...form.theme_config,
                                theme_tags: [...(form.theme_config?.theme_tags || []), val],
                              });
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                      />
                    </div>
                  )}

                  {form.banner_type === 'classic' && ['image_only', 'text_overlay', 'split_left'].includes(form.template) && (
                    <BannerImageUpload
                      value={form.image_url}
                      onChange={(url) => updateField('image_url', url)}
                      label="Banner Image"
                    />
                  )}

                  {form.banner_type === 'classic' && (
                    <>
                      <div>
                        <Label className="text-xs font-semibold">CTA Action</Label>
                        <Select value={form.cta_action} onValueChange={v => updateField('cta_action', v as any)}>
                          <SelectTrigger className="rounded-xl h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="link">Navigate to Link</SelectItem>
                            <SelectItem value="category">Open Category</SelectItem>
                            <SelectItem value="collection">Open Collection</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">
                          {form.cta_action === 'link' ? 'Link URL (route)' : form.cta_action === 'category' ? 'Category Slug' : 'Collection ID'}
                        </Label>
                        <Input
                          value={form.cta_action === 'link' ? form.link_url : form.cta_target}
                          onChange={e => {
                            if (form.cta_action === 'link') updateField('link_url', e.target.value);
                            else updateField('cta_target', e.target.value);
                          }}
                          placeholder={form.cta_action === 'link' ? '/search or /bulletin' : form.cta_action === 'category' ? 'e.g. food_beverages' : 'Collection ID'}
                          className="rounded-xl"
                        />
                      </div>
                      {form.template !== 'image_only' && (
                        <div>
                          <Label className="text-xs font-semibold">Button Text</Label>
                          <Input value={form.button_text} onChange={e => updateField('button_text', e.target.value)} placeholder="Shop Now" className="rounded-xl" />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Festival: Sections Builder */}
                {form.banner_type === 'festival' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sections ({form.sections.length})</Label>
                      <Button size="sm" variant="outline" onClick={addSection} className="gap-1 rounded-xl text-xs h-7">
                        <Plus size={12} /> Add Section
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {form.sections.map((section, idx) => (
                        <div key={idx} className="p-3 rounded-xl border border-border bg-muted/50 space-y-2">
                          <div className="flex items-center gap-2">
                            <AnimatedIconPickerInline
                              value={section.icon_emoji}
                              onChange={(v) => updateSection(idx, 'icon_emoji', v)}
                            />
                            <div className="flex items-center gap-1 shrink-0">
                              {ICON_COLOR_PALETTE.map(c => (
                                <button
                                  key={c.hex}
                                  type="button"
                                  title={c.label}
                                  onClick={() => updateSection(idx, 'icon_color', c.hex)}
                                  className={cn(
                                    'w-5 h-5 rounded-full transition-all border-2',
                                    section.icon_color === c.hex
                                      ? 'border-foreground scale-110 ring-1 ring-foreground/30'
                                      : 'border-transparent hover:scale-110',
                                  )}
                                  style={{ backgroundColor: c.hex }}
                                />
                              ))}
                            </div>
                            <Input
                              value={section.title}
                              onChange={e => updateSection(idx, 'title', e.target.value)}
                              className="flex-1 rounded-lg h-9 text-xs"
                              placeholder="Section title"
                            />
                            <div className="flex items-center gap-0.5">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => moveSection(idx, -1)} disabled={idx === 0}>
                                <ChevronUp size={12} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => moveSection(idx, 1)} disabled={idx === form.sections.length - 1}>
                                <ChevronDown size={12} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => removeSection(idx)}>
                                <X size={12} />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              value={section.product_source_type}
                              onValueChange={v => updateSection(idx, 'product_source_type', v)}
                            >
                              <SelectTrigger className="rounded-lg h-8 text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="category">Category</SelectItem>
                                <SelectItem value="search">Search Keyword</SelectItem>
                                <SelectItem value="manual">Manual</SelectItem>
                              </SelectContent>
                            </Select>
                            {section.product_source_type === 'category' ? (
                              <Select
                                value={section.product_source_value}
                                onValueChange={v => updateSection(idx, 'product_source_value', v)}
                              >
                                <SelectTrigger className="rounded-lg h-8 text-[11px]"><SelectValue placeholder="Select category" /></SelectTrigger>
                                <SelectContent>
                                  {categories.map((c: any) => (
                                    <SelectItem key={c.category} value={c.category}>{c.display_name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={section.product_source_value}
                                onChange={e => updateSection(idx, 'product_source_value', e.target.value)}
                                className="rounded-lg h-8 text-[11px]"
                                placeholder={section.product_source_type === 'search' ? 'e.g. diya, flowers' : 'Product IDs'}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ STEP 3: Targeting & Schedule ═══ */}
            {wizardStep === 2 && (
              <>
                {/* Scheduling */}
                <div className="space-y-3 p-3 bg-muted/60 rounded-xl border border-border/50">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Timer size={12} className="inline mr-1" /> Schedule (Optional)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Start</Label>
                      <Input
                        type="datetime-local"
                        value={form.schedule_start}
                        onChange={e => updateField('schedule_start', e.target.value)}
                        className="rounded-xl h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">End</Label>
                      <Input
                        type="datetime-local"
                        value={form.schedule_end}
                        onChange={e => updateField('schedule_end', e.target.value)}
                        className="rounded-xl h-9 text-xs"
                      />
                    </div>
                  </div>
                  {form.banner_type === 'festival' && (
                    <div className="flex items-center gap-3">
                      <Label className="text-xs font-semibold">Empty Section Fallback</Label>
                      <Select value={form.fallback_mode} onValueChange={v => updateField('fallback_mode', v as any)}>
                        <SelectTrigger className="w-32 rounded-xl h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hide">Hide Section</SelectItem>
                          <SelectItem value="popular">Show Popular</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Smart Society Targeting */}
                <div className="space-y-3 p-3 bg-muted/60 rounded-xl border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    {form.target_society_ids.length === 0 ? <Globe size={14} className="text-primary" /> : <Building2 size={14} className="text-primary" />}
                    <div>
                      <Label className="text-xs font-semibold">Target Societies</Label>
                      <p className="text-[10px] text-muted-foreground">
                        {form.target_society_ids.length === 0 ? 'Global — visible to all societies' : `${form.target_society_ids.length} society(ies) selected`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={form.target_society_ids.length === 0}
                      onChange={(e) => {
                        if (e.target.checked) updateField('target_society_ids', []);
                      }}
                      className="rounded border-border"
                    />
                    <span className="text-xs font-medium">All Societies (Global)</span>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search societies or builders…"
                      value={societySearch}
                      onChange={e => setSocietySearch(e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Builder groups */}
                  {!societySearch.trim() && societiesByBuilder.groups.length > 0 && (
                    <div className="space-y-1 mb-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Select by Builder</p>
                      {societiesByBuilder.groups.map(group => {
                        const groupIds = group.societies.map(s => s.id);
                        const allSelected = groupIds.every(id => form.target_society_ids.includes(id));
                        const someSelected = !allSelected && groupIds.some(id => form.target_society_ids.includes(id));
                        return (
                          <label key={group.builder_id} className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-muted/40 rounded-lg">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => { if (el) el.indeterminate = someSelected; }}
                              onChange={() => toggleBuilderSocieties(group.builder_id)}
                              className="rounded border-border"
                            />
                            <Building2 size={10} className="text-muted-foreground" />
                            <span className="text-xs font-medium">{group.builder_name}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{group.societies.length} societies</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="max-h-40 overflow-y-auto space-y-0.5 border border-border/40 rounded-lg p-2">
                    {filteredSocieties.map((s: any) => (
                      <label key={s.id} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/40 rounded px-1">
                        <input
                          type="checkbox"
                          checked={form.target_society_ids.includes(s.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              updateField('target_society_ids', [...form.target_society_ids, s.id]);
                            } else {
                              updateField('target_society_ids', form.target_society_ids.filter((id: string) => id !== s.id));
                            }
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-xs">{s.name}</span>
                        {s.builder_name && <span className="text-[9px] text-muted-foreground ml-auto">{s.builder_name}</span>}
                      </label>
                    ))}
                    {filteredSocieties.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2">No societies found</p>
                    )}
                  </div>
                </div>

                {/* Config */}
                <div className="space-y-3 p-3 bg-muted/60 rounded-xl border border-border/50">
                  {form.banner_type === 'classic' && (
                    <>
                      <div className="flex items-center gap-3">
                        <Timer size={14} className="text-muted-foreground shrink-0" />
                        <div className="flex-1">
                          <Label className="text-xs font-semibold">Auto-rotate (seconds)</Label>
                        </div>
                        <Input
                          type="number" min={2} max={15}
                          value={form.auto_rotate_seconds}
                          onChange={e => updateField('auto_rotate_seconds', Math.max(2, Math.min(15, parseInt(e.target.value) || 4)))}
                          className="w-16 rounded-xl text-center"
                        />
                      </div>
                      <Separator />
                    </>
                  )}
                  <div className="flex items-center gap-4">
                    <div>
                      <Label className="text-xs font-semibold">Display Order</Label>
                      <Input type="number" value={form.display_order} onChange={e => updateField('display_order', parseInt(e.target.value) || 0)} className="w-20 rounded-xl" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={form.is_active} onCheckedChange={v => updateField('is_active', v)} />
                      <Label className="text-xs font-medium">Active</Label>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ═══ STEP 4: Review & Publish ═══ */}
            {wizardStep === 3 && (
              <>
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Review Summary</Label>

                  {/* Preview */}
                  <div className="rounded-2xl overflow-hidden border border-border/40 shadow-sm">
                    {form.banner_type === 'festival' ? <FestivalPreview form={form} /> : <ClassicPreview form={form} />}
                  </div>

                  {/* Summary cards */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-xl bg-muted/60 border border-border/50">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Type</p>
                      <p className="text-xs font-semibold mt-0.5">{form.banner_type === 'festival' ? '🎉 Festival' : '🖼️ Classic'}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/60 border border-border/50">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Status</p>
                      <p className="text-xs font-semibold mt-0.5">{form.is_active ? '✅ Active' : '⏸️ Inactive'}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/60 border border-border/50">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Targeting</p>
                      <p className="text-xs font-semibold mt-0.5">
                        {form.target_society_ids.length === 0 ? '🌐 Global' : `📍 ${form.target_society_ids.length} societies`}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/60 border border-border/50">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Schedule</p>
                      <p className="text-xs font-semibold mt-0.5">
                        {form.schedule_start || form.schedule_end ? '📅 Scheduled' : '♾️ Always'}
                      </p>
                    </div>
                  </div>

                  {form.banner_type === 'festival' && (
                    <div className="p-3 rounded-xl bg-muted/60 border border-border/50">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">Sections ({form.sections.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {form.sections.map((s, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">
                            {isAnimatedIcon(s.icon_emoji) ? <><AnimatedCategoryIcon iconKey={s.icon_emoji} size={14} /> {s.title || 'Untitled'}</> : <>{s.icon_emoji} {s.title || 'Untitled'}</>}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Validation warnings */}
                  {form.banner_type === 'festival' && form.sections.length === 0 && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p className="text-xs text-destructive font-semibold">⚠️ No sections added — this festival banner won't show any products.</p>
                    </div>
                  )}
                  {!form.title.trim() && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p className="text-xs text-destructive font-semibold">⚠️ Title is empty — go back to add one.</p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={closeSheet}>Cancel</Button>
                  {!editingId && (
                    <Button
                      variant="secondary"
                      className="flex-1 rounded-xl h-11 font-semibold"
                      onClick={() => {
                        updateField('is_active', false);
                        setTimeout(() => saveMutation.mutate({ ...form, is_active: false }), 0);
                      }}
                      disabled={saveMutation.isPending || isValidating}
                    >
                      💾 Save as Draft
                    </Button>
                  )}
                  <Button
                    className="flex-1 rounded-xl h-11 font-semibold"
                    onClick={handleSave}
                    disabled={saveMutation.isPending || isValidating}
                  >
                    {isValidating ? 'Validating...' : saveMutation.isPending ? 'Saving...' : editingId ? 'Update' : '🚀 Publish'}
                  </Button>
                </div>
              </>
            )}

            {/* ── Wizard Navigation ── */}
            {wizardStep < 3 && (
              <div className="flex gap-2 pt-2">
                {wizardStep > 0 && (
                  <Button variant="outline" className="flex-1 rounded-xl h-11 gap-1.5" onClick={() => setWizardStep(s => s - 1)}>
                    <ChevronLeft size={14} /> Back
                  </Button>
                )}
                <Button
                  className="flex-1 rounded-xl h-11 font-semibold gap-1.5"
                  onClick={() => setWizardStep(s => s + 1)}
                  disabled={!canGoNext()}
                >
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/* ── Festival Preview ── */
function FestivalPreview({ form }: { form: BannerForm }) {
  const gradient = form.theme_config?.gradient || [];
  const bgColor = form.theme_config?.bg || form.bg_color || '#16a34a';
  const style = gradient.length >= 2
    ? { background: `linear-gradient(135deg, ${gradient.join(', ')})` }
    : { backgroundColor: bgColor };

  const animClass = form.animation_config?.type && form.animation_config.type !== 'none'
    ? `banner-anim-${form.animation_config.type} banner-intensity-${form.animation_config.intensity || 'subtle'}`
    : '';

  return (
    <div>
      <div className={cn('px-4 py-4 relative', animClass)} style={style}>
        {form.badge_text && (
          <span className="absolute top-2 right-2 bg-white/20 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
            {form.badge_text}
          </span>
        )}
        <h3 className="text-white font-extrabold text-sm">{form.title || 'Festival Title'}</h3>
        {form.subtitle && <p className="text-white/80 text-[10px] mt-0.5">{form.subtitle}</p>}
      </div>
      {form.sections.length > 0 && (
        <div className="bg-card px-3 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
          {form.sections.map((s, i) => (
            <div key={i} className="shrink-0 w-20 rounded-xl border border-border/50 p-2 text-center">
              {isAnimatedIcon(s.icon_emoji) ? <AnimatedCategoryIcon iconKey={s.icon_emoji} size={24} color={s.icon_color || "hsl(var(--primary))"} /> : <span className="text-lg">{s.icon_emoji || '📦'}</span>}
              <p className="text-[9px] font-semibold mt-0.5 line-clamp-1">{s.title || 'Section'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Classic Preview ── */
function ClassicPreview({ form }: { form: BannerForm }) {
  const { title, subtitle, image_url, button_text, bg_color, template } = form;

  if (template === 'image_only') {
    return image_url ? (
      <img src={image_url} alt={title} className="w-full h-28 object-cover" />
    ) : (
      <div className="w-full h-28 bg-muted flex items-center justify-center text-sm text-muted-foreground">Add an image URL</div>
    );
  }

  if (template === 'text_overlay') {
    return (
      <div className="relative w-full h-28">
        {image_url ? <img src={image_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" style={{ backgroundColor: bg_color }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent flex flex-col justify-end p-3">
          <h3 className="text-white font-bold text-xs">{title || 'Title'}</h3>
          {subtitle && <p className="text-white/80 text-[10px]">{subtitle}</p>}
          {button_text && <span className="mt-1 inline-block bg-white text-black text-[10px] font-bold px-2 py-0.5 rounded-full w-fit">{button_text}</span>}
        </div>
      </div>
    );
  }

  if (template === 'split_left') {
    return (
      <div className="flex h-28" style={{ backgroundColor: bg_color }}>
        <div className="flex-1 flex flex-col justify-center p-3">
          <h3 className="text-white font-bold text-xs">{title || 'Title'}</h3>
          {subtitle && <p className="text-white/80 text-[9px] mt-0.5">{subtitle}</p>}
          {button_text && <span className="mt-1 inline-block bg-white text-[10px] font-bold px-2 py-0.5 rounded-full w-fit" style={{ color: bg_color }}>{button_text}</span>}
        </div>
        {image_url && <img src={image_url} alt="" className="w-2/5 h-full object-cover" />}
      </div>
    );
  }

  if (template === 'gradient_cta') {
    return (
      <div className="w-full h-28 flex flex-col items-center justify-center text-center p-3" style={{ background: `linear-gradient(135deg, ${bg_color}, ${bg_color}cc)` }}>
        <h3 className="text-white font-extrabold text-sm">{title || 'Title'}</h3>
        {subtitle && <p className="text-white/85 text-[10px] mt-0.5">{subtitle}</p>}
        {button_text && <span className="mt-1.5 bg-white text-[10px] font-bold px-3 py-1 rounded-full" style={{ color: bg_color }}>{button_text}</span>}
      </div>
    );
  }

  return (
    <div className="w-full h-28 flex flex-col items-center justify-center p-4 bg-card border-l-4" style={{ borderColor: bg_color }}>
      <h3 className="font-bold text-sm text-foreground">{title || 'Title'}</h3>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}
