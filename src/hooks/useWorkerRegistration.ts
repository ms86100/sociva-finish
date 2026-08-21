// @ts-nocheck
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { friendlyError } from '@/lib/utils';
import { workerRegistrationSchema, validateForm } from '@/lib/validation-schemas';
import { useQuery } from '@tanstack/react-query';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import { notify } from '@/lib/notify';
import { showFeedback } from '@/components/FeedbackPopupProvider';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export { DAYS };

export function useWorkerRegistration(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSuccess: () => void,
  categories: { id: string; name: string; entry_type: string }[] = [],
) {
  const { user, effectiveSocietyId } = useAuth();
  const { getSetting } = useSystemSettingsRaw([
    'worker_default_shift_start', 'worker_default_shift_end', 'worker_entry_frequency_options'
  ]);

  const defaultShiftStart = getSetting('worker_default_shift_start') || '';
  const defaultShiftEnd = getSetting('worker_default_shift_end') || '';
  const entryFrequencyOptions: { value: string; label: string }[] = useMemo(() => {
    try { const raw = getSetting('worker_entry_frequency_options'); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  }, [getSetting]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [workerType, setWorkerType] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [activeDays, setActiveDays] = useState<string[]>([...DAYS]);
  const [entryFrequency, setEntryFrequency] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [flatNumbers, setFlatNumbers] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (defaultShiftStart && !shiftStart) setShiftStart(defaultShiftStart);
    if (defaultShiftEnd && !shiftEnd) setShiftEnd(defaultShiftEnd);
  }, [defaultShiftStart, defaultShiftEnd]);

  useEffect(() => {
    if (!categoryId) {
      setWorkerType('');
      return;
    }
    const selectedCategory = categories.find(c => c.id === categoryId);
    if (selectedCategory) {
      setWorkerType(selectedCategory.name);
    }
  }, [categoryId, categories]);

  const { data: languages = [] } = useQuery({
    queryKey: ['supported-languages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supported_languages').select('code, name, native_name').eq('is_active', true).order('display_order');
      if (error) { console.error('Error fetching languages:', error); return []; }
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const toggleDay = useCallback((day: string) => {
    setActiveDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }, []);

  const handlePhotoCapture = useCallback((blob: Blob) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(blob);
    setPhotoPreview(URL.createObjectURL(blob));
  }, [photoPreview]);

  const clearPhoto = useCallback(() => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(null);
    setPhotoPreview(null);
  }, [photoPreview]);

  const resetForm = useCallback(() => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setName(''); setPhone(''); setWorkerType('');
    setCategoryId(null); setShiftStart(defaultShiftStart); setShiftEnd(defaultShiftEnd);
    setActiveDays([...DAYS]); setEntryFrequency('');
    setEmergencyPhone(''); setFlatNumbers('');
    setPreferredLanguage('');
    setPhotoBlob(null); setPhotoPreview(null);
    setFieldErrors({});
  }, [photoPreview, defaultShiftStart, defaultShiftEnd]);

  useEffect(() => { if (!open) resetForm(); }, [open]);
  useEffect(() => { return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }; }, [photoPreview]);

  const handleSubmit = useCallback(async () => {
    if (!user || !effectiveSocietyId) { notify.block('Please log in and select a society'); return; }

    const validation = validateForm(workerRegistrationSchema, {
      name, phone, workerType, shiftStart, shiftEnd, entryFrequency, emergencyPhone, flatNumbers, preferredLanguage,
    });

    if (!validation.success) {
      const errors = (validation as { success: false; errors: Record<string, string> }).errors;
      setFieldErrors(errors);
      toast.error(Object.values(errors)[0] as string);
      return;
    }

    // Photo is optional
    if (activeDays.length === 0) { notify.block('Select at least one active day'); return; }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      let publicUrl: string | null = null;
      if (photoBlob) {
        const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `workers/${effectiveSocietyId}/${Date.now()}_${sanitizedName}.jpg`;
        const { error: uploadError } = await supabase.storage.from('app-images').upload(fileName, photoBlob, { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('app-images').getPublicUrl(fileName);
        publicUrl = data.publicUrl;
      }

      const { data: worker, error } = await supabase.from('society_workers').insert({
        user_id: user.id, society_id: effectiveSocietyId, worker_type: workerType,
        photo_url: publicUrl, allowed_shift_start: shiftStart, allowed_shift_end: shiftEnd,
        active_days: activeDays, entry_frequency: entryFrequency,
        emergency_contact_phone: emergencyPhone || null, category_id: categoryId || null,
        registered_by: user.id, skills: { name: name.trim(), phone: phone || null },
        languages: [], preferred_language: preferredLanguage,
      }).select('id').single();

      if (error) throw error;

      if (flatNumbers.trim() && worker) {
        const flats = flatNumbers.split(',').map(f => f.trim()).filter(Boolean);
        if (flats.length > 0) {
          const assignments = flats.map(flat => ({ worker_id: worker.id, society_id: effectiveSocietyId, flat_number: flat, assigned_by: user.id }));
          const { error: flatError } = await supabase.from('worker_flat_assignments').insert(assignments);
          if (flatError) { console.error('Flat assignment error:', flatError); toast.error('Worker registered but flat assignments failed'); }
        }
      }

      await logAudit('worker_registered', 'society_worker', worker?.id || '', effectiveSocietyId, { worker_type: workerType, name: name.trim() });

      showFeedback({
        title: 'Worker registered successfully',
        variant: 'success',
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(friendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [user, effectiveSocietyId, name, phone, workerType, shiftStart, shiftEnd, entryFrequency, emergencyPhone, flatNumbers, preferredLanguage, photoBlob, activeDays, categoryId, onSuccess, onOpenChange]);

  const isSubmitDisabled = !name.trim() || isSubmitting;

  return {
    name, setName, phone, setPhone, workerType, setWorkerType,
    categoryId, setCategoryId, shiftStart, setShiftStart, shiftEnd, setShiftEnd,
    activeDays, toggleDay, entryFrequency, setEntryFrequency,
    emergencyPhone, setEmergencyPhone, flatNumbers, setFlatNumbers,
    preferredLanguage, setPreferredLanguage,
    photoBlob, photoPreview, handlePhotoCapture, clearPhoto,
    isSubmitting, fieldErrors, languages, entryFrequencyOptions,
    handleSubmit, isSubmitDisabled, categories,
  };
}
