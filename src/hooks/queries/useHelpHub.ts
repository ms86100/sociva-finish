// @ts-nocheck
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  createDemoCallFeedback,
  createDemoEnquiry,
  createDemoListing,
  getDemoEnquiries,
  getDemoListings,
  isHelpHubDemoMode,
  updateDemoEnquiryStatus,
  updateDemoListingStatus,
} from '@/lib/helphub/demo-store';
import type { HelpHubCallFeedbackValue } from '@/lib/helphub/constants';
import { filterHelpHubListings } from '@/lib/helphub/mock-data';
import type {
  HelpHubCreateListingInput,
  HelpHubEnquiry,
  HelpHubListing,
} from '@/lib/helphub/types';

export interface HelpHubFilters {
  category?: string;
  workType?: string;
  availability?: string;
  query?: string;
  salaryMin?: number;
  salaryMax?: number;
}

function mapListingRow(row: Record<string, unknown>): HelpHubListing {
  return {
    id: String(row.id),
    society_id: String(row.society_id),
    created_by: String(row.created_by),
    display_name: String(row.display_name),
    category: row.category as HelpHubListing['category'],
    work_type: row.work_type as HelpHubListing['work_type'],
    availability: row.availability as HelpHubListing['availability'],
    available_from: row.available_from
      ? String(row.available_from).slice(0, 5)
      : null,
    available_to: row.available_to ? String(row.available_to).slice(0, 5) : null,
    preferred_area: (row.preferred_area as string) || null,
    languages: (row.languages as string[]) || [],
    description: (row.description as string) || null,
    expected_salary: row.expected_salary != null ? Number(row.expected_salary) : null,
    experience_years: row.experience_years != null ? Number(row.experience_years) : null,
    source: row.source as HelpHubListing['source'],
    status: row.status as HelpHubListing['status'],
    recommender_name: (row.recommender_name as string) || null,
    recommender_flat: (row.recommender_flat as string) || null,
    tower_or_block: (row.tower_or_block as string) || null,
    contact_phone: (row.contact_phone as string) || null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function useHelpHubMode() {
  const location = useLocation();
  // Re-evaluate when route/search changes
  const forcedDemo = useMemo(() => isHelpHubDemoMode(), [location.search, location.hash, location.pathname]);
  return { forcedDemo };
}

export function useHelpHubListings(filters: HelpHubFilters = {}) {
  const { effectiveSocietyId, profile } = useAuth();
  const { forcedDemo } = useHelpHubMode();
  const [usingDemo, setUsingDemo] = useState(forcedDemo);

  const query = useQuery({
    queryKey: ['helphub-listings', effectiveSocietyId, filters, forcedDemo],
    queryFn: async () => {
      // Demo samples only when explicitly requested (?demo=1). Live/default never invents workers.
      if (forcedDemo) {
        setUsingDemo(true);
        return filterHelpHubListings(getDemoListings(), filters);
      }
      setUsingDemo(false);
      if (!effectiveSocietyId) return [];

      let q = supabase
        .from('helphub_listings')
        .select(
          'id, society_id, created_by, display_name, category, work_type, availability, available_from, available_to, preferred_area, languages, description, expected_salary, experience_years, source, status, recommender_name, recommender_flat, tower_or_block, expires_at, created_at, updated_at',
        )
        .eq('society_id', effectiveSocietyId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (filters.category && filters.category !== 'all') {
        q = q.eq('category', filters.category);
      }
      if (filters.workType && filters.workType !== 'all') {
        q = q.eq('work_type', filters.workType);
      }
      if (filters.availability && filters.availability !== 'all') {
        q = q.eq('availability', filters.availability);
      }
      if (filters.salaryMin != null) {
        q = q.gte('expected_salary', filters.salaryMin);
      }
      if (filters.salaryMax != null) {
        q = q.lte('expected_salary', filters.salaryMax);
      }

      const { data, error } = await q;
      if (error) throw error;
      let listings = (data || []).map(mapListingRow);
      if (filters.query) {
        listings = filterHelpHubListings(listings, { query: filters.query });
      }
      return listings;
    },
    enabled: true,
    staleTime: 30_000,
  });

  return {
    ...query,
    usingDemo: forcedDemo || usingDemo,
    societyName: profile?.society_id ? 'your society' : 'your society',
  };
}

export function useHelpHubListing(listingId: string | undefined) {
  const { effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();

  return useQuery({
    queryKey: ['helphub-listing', listingId, forcedDemo, effectiveSocietyId],
    queryFn: async () => {
      if (!listingId) return null;
      if (forcedDemo) {
        return getDemoListings().find((l) => l.id === listingId) || null;
      }
      // Demo ids never hit Postgres (uuid column) - read session store only.
      if (String(listingId).startsWith('hh-')) {
        return getDemoListings().find((l) => l.id === listingId) || null;
      }
      const { data, error } = await supabase
        .from('helphub_listings')
        .select(
          'id, society_id, created_by, display_name, category, work_type, availability, available_from, available_to, preferred_area, languages, description, expected_salary, experience_years, source, status, recommender_name, recommender_flat, tower_or_block, expires_at, created_at, updated_at',
        )
        .eq('id', listingId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapListingRow(data) : null;
    },
    enabled: !!listingId,
  });
}

function isMissingRpcError(message: string | undefined) {
  if (!message) return false;
  // Only treat true missing-RPC / schema-cache misses as prototype fallback.
  // Do NOT match business errors like "HelpHub is not enabled for this society".
  return (
    /could not find the function/i.test(message) ||
    /schema cache/i.test(message) ||
    (/does not exist/i.test(message) && /function/i.test(message))
  );
}

export function useCreateHelpHubListing() {
  const { user, profile, effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: HelpHubCreateListingInput) => {
      if (!input.consent_confirmed) {
        throw new Error('Consent is required before publishing');
      }
      if (forcedDemo) {
        return createDemoListing(input, user?.id || 'demo-user', profile?.name || 'A resident');
      }
      if (!effectiveSocietyId) {
        throw new Error('Join a society before publishing a HelpHub recommendation');
      }
      const { data, error } = await supabase.rpc('helphub_create_listing', {
        p_display_name: input.display_name,
        p_category: input.category,
        p_work_type: input.work_type,
        p_availability: input.availability,
        p_preferred_area: input.preferred_area || null,
        p_languages: input.languages || [],
        p_description: input.description || null,
        p_expected_salary: input.expected_salary ?? null,
        p_experience_years: input.experience_years ?? null,
        p_private_phone: input.private_phone || null,
        p_recommender_flat: input.recommender_flat || null,
        p_source: input.source,
        p_consent_confirmed: input.consent_confirmed,
        p_tower_or_block: input.tower_or_block || null,
        p_available_from: input.available_from || null,
        p_available_to: input.available_to || null,
      });
      if (error) {
        if (isMissingRpcError(error.message)) {
          return createDemoListing(input, user?.id || 'demo-user', profile?.name || 'A resident');
        }
        throw error;
      }
      return mapListingRow(data as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['helphub-listings'] });
      queryClient.invalidateQueries({ queryKey: ['helphub-admin-listings'] });
      queryClient.invalidateQueries({ queryKey: ['helphub-admin-stats'] });
    },
  });
}

/** Resolve phone for direct dial - demo uses listing.contact_phone; live uses RPC. */
export function useHelpHubContact() {
  const { forcedDemo } = useHelpHubMode();
  const { effectiveSocietyId } = useAuth();

  return useMutation({
    mutationFn: async (listing: HelpHubListing) => {
      if (listing.contact_phone) return listing.contact_phone;

      if (forcedDemo || !effectiveSocietyId || String(listing.id).startsWith('hh-')) {
        try {
          const map = JSON.parse(sessionStorage.getItem('sociva_helphub_demo_phones') || '{}') as Record<
            string,
            string
          >;
          if (map[listing.id]) return map[listing.id];
        } catch {
          /* ignore */
        }
        const { HELPHUB_MOCK_PHONES } = await import('@/lib/helphub/mock-data');
        return HELPHUB_MOCK_PHONES[listing.id] || null;
      }

      const { data, error } = await supabase.rpc('helphub_get_contact_phone', {
        p_listing_id: listing.id,
      });
      if (error) throw error;
      return (data as string) || null;
    },
  });
}

export function useSendHelpHubEnquiry() {
  const { user, effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listingId, message }: { listingId: string; message?: string }) => {
      if (forcedDemo || !effectiveSocietyId) {
        return createDemoEnquiry(listingId, user?.id || 'demo-user', message);
      }
      const { data, error } = await supabase.rpc('helphub_send_enquiry', {
        p_listing_id: listingId,
        p_message: message || null,
      });
      if (error) {
        if (/helphub|does not exist|schema cache/i.test(error.message || '')) {
          return createDemoEnquiry(listingId, user?.id || 'demo-user', message);
        }
        throw error;
      }
      return data as HelpHubEnquiry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['helphub-enquiries'] });
    },
  });
}

export function useMyHelpHubEnquiries() {
  const { user, effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();

  return useQuery({
    queryKey: ['helphub-enquiries', user?.id, forcedDemo],
    queryFn: async () => {
      if (forcedDemo || !effectiveSocietyId) {
        return getDemoEnquiries().filter((e) => e.from_user_id === (user?.id || 'demo-user'));
      }
      try {
        const { data, error } = await supabase
          .from('helphub_enquiries')
          .select('*')
          .eq('from_user_id', user!.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []) as HelpHubEnquiry[];
      } catch {
        return getDemoEnquiries().filter((e) => e.from_user_id === (user?.id || 'demo-user'));
      }
    },
    enabled: !!user?.id || forcedDemo,
  });
}

export function useHelpHubOwnerActions() {
  const { user, effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['helphub-listings'] });
    queryClient.invalidateQueries({ queryKey: ['helphub-listing'] });
  }, [queryClient]);

  const markHired = useMutation({
    mutationFn: async (listingId: string) => {
      if (forcedDemo || !effectiveSocietyId) {
        return updateDemoListingStatus(listingId, 'hired', user?.id || 'demo-user');
      }
      const { error } = await supabase.rpc('helphub_mark_hired', { p_listing_id: listingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const renew = useMutation({
    mutationFn: async (listingId: string) => {
      if (forcedDemo || !effectiveSocietyId) {
        return updateDemoListingStatus(listingId, 'active', user?.id || 'demo-user');
      }
      const { error } = await supabase.rpc('helphub_renew_listing', { p_listing_id: listingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (listingId: string) => {
      if (forcedDemo || !effectiveSocietyId) {
        return updateDemoListingStatus(listingId, 'removed', user?.id || 'demo-user');
      }
      const { error } = await supabase.rpc('helphub_update_listing_status', {
        p_listing_id: listingId,
        p_status: 'removed',
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { markHired, renew, remove };
}

export function useHelpHubEnquiryActions() {
  const { forcedDemo, } = useHelpHubMode();
  const { effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      enquiryId,
      status,
      sharedPhone,
    }: {
      enquiryId: string;
      status: HelpHubEnquiry['status'];
      sharedPhone?: string;
    }) => {
      if (forcedDemo || !effectiveSocietyId) {
        return updateDemoEnquiryStatus(enquiryId, status, sharedPhone);
      }
      const { data, error } = await supabase.rpc('helphub_respond_enquiry', {
        p_enquiry_id: enquiryId,
        p_status: status,
        p_shared_phone: sharedPhone || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['helphub-enquiries'] });
    },
  });
}

export function useReportHelpHubListing() {
  const { forcedDemo } = useHelpHubMode();
  const { effectiveSocietyId } = useAuth();

  return useMutation({
    mutationFn: async ({
      listingId,
      reason,
      details,
    }: {
      listingId: string;
      reason: string;
      details?: string;
    }) => {
      if (forcedDemo || !effectiveSocietyId) {
        return { ok: true };
      }
      const { error } = await supabase.rpc('helphub_report_listing', {
        p_listing_id: listingId,
        p_reason: reason,
        p_details: details || null,
      });
      if (error) throw error;
      return { ok: true };
    },
  });
}

/** Post-call outcome from a resident - demo stores locally; live uses RPC. */
export function useSubmitHelpHubCallFeedback() {
  const { user, effectiveSocietyId } = useAuth();
  const { forcedDemo } = useHelpHubMode();

  return useMutation({
    mutationFn: async ({
      listingId,
      outcome,
      note,
    }: {
      listingId: string;
      outcome: HelpHubCallFeedbackValue;
      note?: string;
    }) => {
      if (forcedDemo || !effectiveSocietyId || String(listingId).startsWith('hh-')) {
        return createDemoCallFeedback(
          listingId,
          user?.id || 'demo-user',
          outcome,
          note,
        );
      }
      const { data, error } = await supabase.rpc('helphub_submit_call_feedback', {
        p_listing_id: listingId,
        p_outcome: outcome,
        p_note: note || null,
      });
      if (error) {
        if (isMissingRpcError(error.message)) {
          return createDemoCallFeedback(
            listingId,
            user?.id || 'demo-user',
            outcome,
            note,
          );
        }
        throw error;
      }
      return data;
    },
  });
}
