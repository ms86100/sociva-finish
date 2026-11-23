-- Smart Groups rigorous seed: 400+ interactions for Greenfield Tower H pilot society.
-- Temporarily disables blast/cap triggers; restores them after seed.
-- Emoji via chr() so migration tooling does not mangle Unicode escapes.

DO $$
DECLARE
  v_society uuid := '327fb699-542e-4ab6-b0b1-97022604bb88';
  v_authors uuid[];
  v_author uuid;
  v_post_id uuid;
  v_i int;
  v_j int;
  v_cat text;
  v_svc text;
  v_title text;
  v_body text;
  v_comment text;
  v_img text;
  v_type text;
  v_cats text[] := ARRAY[
    'find_help','recommendation','rent_sell','buy_sell','announcement',
    'event','alert','maintenance','lost_found','poll'
  ];
  v_services text[] := ARRAY[
    'cook','maid','electrician','plumber','driver','nanny','carpenter','ac_service','puncture'
  ];
  v_posts_created int := 0;
  v_comments_created int := 0;
  v_votes_created int := 0;
  v_recs_created int := 0;
  -- emoji codepoints
  e_pray int := 128591;       -- praying hands
  e_weary int := 128553;      -- weary
  e_check int := 9989;        -- white heavy check mark
  e_blue int := 128153;       -- blue heart
  e_rocket int := 128640;     -- rocket
  e_home int := 127968;       -- house
  e_raise int := 128588;      -- raising hands
  e_key int := 128273;        -- key
  e_office int := 127970;     -- office
  e_cal int := 128197;        -- calendar
  e_spark int := 10024;       -- sparkles
  e_diya int := 129684;       -- diya lamp (U+1FA94)
  e_chair int := 129681;      -- chair
  e_bento int := 127857;      -- bento
  e_broom int := 129529;      -- broom
  e_relief int := 128524;     -- relieved
  e_mag int := 128269;        -- magnifying glass
  e_cookie int := 127850;     -- cookie
  e_star int := 11088;        -- star
  e_zap int := 9889;          -- zap
  e_smile int := 128578;      -- slight smile
  e_badminton int := 127992;  -- badminton
  e_sweat int := 128517;      -- sweat smile
  e_thumb int := 128077;      -- thumbs up
  e_fire int := 128293;       -- fire
  e_100 int := 128175;        -- 100
  e_lock int := 128272;       -- locked with key
  e_wrench int := 128295;     -- wrench
  e_cart int := 128722;       -- shopping cart
  e_mega int := 128226;       -- mega
  e_warn int := 9888;         -- warning
  e_fix int := 128295;       -- wrench/tools
  e_chart int := 128202;      -- bar chart
  e_party int := 127881;      -- party popper
  v_chatgpt_bodies text[];
  v_chatgpt_comments text[];
  v_images text[] := ARRAY[
    'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&q=80',
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80',
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80'
  ];
BEGIN
  v_chatgpt_bodies := ARRAY[
    'Hi neighbours ' || chr(e_pray) || E'\n\nI wanted to share a practical update from our wing.\n\n'
      || E'Over the last few weeks we have been getting a lot of WhatsApp forwards about domestic help, rentals and weekend plans. Useful messages get buried under stickers and good morning forwards '
      || chr(e_weary) || E'\n\nCould we please keep this thread focused on real community needs?\n\n'
      || chr(e_check) || E' What I am looking for:\n1) A reliable cook for breakfast + lunch\n2) Someone who can start from next Monday\n3) Preferably tower H / nearby\n\n'
      || E'If you have a recommendation, please comment with:\n- Name\n- Rough availability\n- How you know them\n- Contact preference (call / WhatsApp)\n\n'
      || 'Thanks a lot ' || chr(e_blue) || E'\nSociva neighbours rock ' || chr(e_rocket),
    'Quick question for Shriram Greenfield ' || chr(e_home) || E'\n\nHas anyone recently rented or listed a 2BHK?\n\n'
      || E'I drafted this note (pasted from ChatGPT, edited for our society):\n\n'
      || E'"Looking for a well-maintained 2BHK available from December. Prefer semi-furnished, covered parking, and a quiet stack. Happy to connect with owners or residents who know of a genuine listing. Please avoid broker spam."\n\n'
      || 'If you know someone moving out, drop a comment ' || chr(e_raise) || E'\nEmoji check: '
      || chr(e_key) || ' ' || chr(e_office) || ' ' || chr(e_cal) || ' ' || chr(e_spark),
    'Festival vibes ' || chr(e_diya) || chr(e_spark) || E'\n\nPrasad distribution plan for this weekend near the clubhouse.\n\n'
      || E'Timing: 6:00 PM onwards\nLocation: Clubhouse lawn\nEveryone is welcome - kids, elders, new residents.\n\n'
      || E'Please comment if you can volunteer for:\n- Seating setup ' || chr(e_chair)
      || E'\n- Distribution ' || chr(e_bento)
      || E'\n- Cleanup ' || chr(e_broom)
      || E'\n\nLet''s make it warm and organised, not another noisy group chat fight ' || chr(e_relief),
    'Lost and found alert ' || chr(e_mag) || E'\n\nLost my car key near the clubhouse yesterday evening around 7:30 PM.\n'
      || E'Black key with a small Sociva keychain charm.\n\nIf found, please comment here or message me.\n'
      || 'Reward: big thank you + homemade cookies ' || chr(e_cookie) || chr(e_pray),
    'Service recommendation thread ' || chr(e_star) || E'\n\nSharing an honest neighbour recommendation (not a paid promo):\n\n'
      || E'We used a local electrician for fan + switchboard work in H block.\n'
      || E'Work quality was solid, arrived on time, quoted clearly.\n\n'
      || E'If you need the contact, comment "need contact" and I will share privately based on preference.\n\n'
      || E'Remember: neighbour recommendation is not background verification.'
  ];

  v_chatgpt_comments := ARRAY[
    'Yes! ' || chr(e_raise) || ' We used Asha aunty for cooking last year. Very consistent with breakfast and lunch. Happy to recommend.',
    E'Pasting a clearer reply (edited):\n\n'
      || E'"I can recommend Ramesh for electrical work. He fixed our MCB and balcony lights last month. Available on weekdays after 5 PM."\n\n'
      || 'Hope this helps ' || chr(e_zap) || chr(e_smile),
    'Count me in for badminton this weekend ' || chr(e_badminton) || E'\nTower H terrace works if clubhouse is booked.',
    'Thanks for posting this properly here instead of 15 WhatsApp groups ' || chr(e_sweat) || E'\nSaved and sharing with my flat.',
    chr(e_thumb) || ' Useful thread. Adding: puncture shop near main gate is open till 9 PM.',
    chr(e_pray) || ' Prasad at 6 PM works for us. Can bring paper plates.',
    'Emoji stack test: ' || chr(e_fire) || chr(e_100) || chr(e_check) || chr(e_home) || chr(e_diya) || chr(e_key) || chr(e_star) || chr(e_smile) || chr(e_rocket) || chr(e_blue)
      || E'\nAlso: someone please pin important announcements.',
    E'ChatGPT draft I adapted:\n\n'
      || E'"Looking for part-time maid for 2BHK, 1 hour daily, preferably morning slot. Prefer someone already working in Tower H so coordination is easier."\n\n'
      || 'Any leads? ' || chr(e_broom),
    'I found a similar key near visitor parking yesterday. Check with security desk ' || chr(e_lock),
    'Recommendation: Suresh plumber - quick for tap leaks. Not verified by Sociva, just neighbour experience ' || chr(e_wrench)
  ];

  ALTER TABLE public.bulletin_posts DISABLE TRIGGER trg_enforce_bulletin_daily_post_cap;
  ALTER TABLE public.bulletin_comments DISABLE TRIGGER trg_notify_bulletin_comment_reply;

  SELECT coalesce(array_agg(id ORDER BY created_at), ARRAY[]::uuid[])
  INTO v_authors
  FROM public.profiles
  WHERE society_id = v_society
    AND verification_status = 'approved';

  IF coalesce(array_length(v_authors, 1), 0) < 3 THEN
    RAISE EXCEPTION 'Need at least 3 approved residents in society % for seed', v_society;
  END IF;

  FOR v_i IN 1..50 LOOP
    v_author := v_authors[1 + ((v_i - 1) % array_length(v_authors, 1))];
    v_cat := v_cats[1 + ((v_i - 1) % array_length(v_cats, 1))];
    v_svc := CASE
      WHEN v_cat IN ('find_help', 'recommendation') THEN v_services[1 + ((v_i - 1) % array_length(v_services, 1))]
      ELSE NULL
    END;
    v_body := v_chatgpt_bodies[1 + ((v_i - 1) % array_length(v_chatgpt_bodies, 1))];
    v_img := CASE WHEN v_i % 3 = 0 THEN v_images[1 + ((v_i / 3) % array_length(v_images, 1))] ELSE NULL END;
    v_type := CASE v_cat
      WHEN 'event' THEN 'event'
      WHEN 'poll' THEN 'poll'
      WHEN 'alert' THEN 'alert'
      WHEN 'lost_found' THEN 'lost_found'
      WHEN 'recommendation' THEN 'recommendation'
      ELSE 'general'
    END;

    v_title := CASE v_cat
      WHEN 'find_help' THEN format('Need help: %s in Tower H #%s %s', replace(v_svc, '_', ' '), v_i, chr(e_pray))
      WHEN 'recommendation' THEN format('Neighbour tip: great %s %s #%s', replace(v_svc, '_', ' '), chr(e_star), v_i)
      WHEN 'rent_sell' THEN format('2BHK / rental note #%s %s', v_i, chr(e_home))
      WHEN 'buy_sell' THEN format('Buy and sell listing #%s %s', v_i, chr(e_cart))
      WHEN 'announcement' THEN format('Society announcement #%s %s', v_i, chr(e_mega))
      WHEN 'event' THEN format('Community event / festival #%s %s', v_i, chr(e_diya))
      WHEN 'alert' THEN format('Important alert #%s %s', v_i, chr(e_warn))
      WHEN 'maintenance' THEN format('Maintenance update #%s %s', v_i, chr(e_fix))
      WHEN 'lost_found' THEN format('Lost and found #%s %s', v_i, chr(e_mag))
      ELSE format('Community poll idea #%s %s', v_i, chr(e_chart))
    END;

    INSERT INTO public.bulletin_posts (
      society_id, author_id, category, title, body, attachment_urls,
      intent, service_category, status, structured, tags, type, visibility
    ) VALUES (
      v_society,
      v_author,
      v_cat,
      v_title,
      v_body || E'\n\n[seed #' || v_i || ']',
      CASE WHEN v_img IS NULL THEN '{}'::text[] ELSE ARRAY[v_img] END,
      CASE
        WHEN v_cat = 'find_help' THEN 'find_help:' || coalesce(v_svc, 'general')
        WHEN v_cat = 'recommendation' THEN 'recommendation:' || coalesce(v_svc, 'general')
        ELSE v_cat
      END,
      v_svc,
      'open',
      jsonb_build_object('seed', true, 'batch', 'smart_groups_e2e_400', 'n', v_i),
      ARRAY['seed', 'smart_groups', coalesce(v_svc, v_cat)],
      v_type,
      'society'
    )
    RETURNING id INTO v_post_id;

    INSERT INTO public.bulletin_post_categories (post_id, category, is_primary)
    VALUES (v_post_id, v_cat, true)
    ON CONFLICT DO NOTHING;

    IF v_cat = 'find_help' AND v_i % 2 = 0 THEN
      INSERT INTO public.bulletin_post_categories (post_id, category, is_primary)
      VALUES (v_post_id, 'recommendation', false)
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.bulletin_post_classifications (
      post_id, intent, suggested_categories, service_category, confidence, match_band, user_corrected, raw_signals
    ) VALUES (
      v_post_id,
      CASE
        WHEN v_cat = 'find_help' THEN 'find_help:' || coalesce(v_svc, 'general')
        ELSE v_cat
      END,
      ARRAY[v_cat],
      v_svc,
      0.70 + ((v_i % 25)::numeric / 100.0),
      CASE WHEN v_i % 3 = 0 THEN 'strong' ELSE 'reasonable' END,
      false,
      jsonb_build_object('seed', true, 'source', 'smart_groups_e2e_400')
    )
    ON CONFLICT (post_id) DO NOTHING;

    v_posts_created := v_posts_created + 1;

    FOR v_j IN 1..6 LOOP
      v_author := v_authors[1 + ((v_i + v_j) % array_length(v_authors, 1))];
      v_comment := v_chatgpt_comments[1 + ((v_i + v_j - 1) % array_length(v_chatgpt_comments, 1))]
        || E'\n\n- ' || (v_i)::text || '.' || (v_j)::text;

      INSERT INTO public.bulletin_comments (post_id, author_id, body, is_recommendation)
      VALUES (
        v_post_id,
        v_author,
        v_comment,
        (v_cat IN ('find_help', 'recommendation') AND v_j IN (1, 2))
      );

      v_comments_created := v_comments_created + 1;
      IF (v_cat IN ('find_help', 'recommendation') AND v_j IN (1, 2)) THEN
        v_recs_created := v_recs_created + 1;
      END IF;
    END LOOP;

    FOR v_j IN 1..2 LOOP
      v_author := v_authors[1 + ((v_i + v_j + 3) % array_length(v_authors, 1))];
      BEGIN
        INSERT INTO public.bulletin_votes (post_id, user_id, vote_type)
        VALUES (v_post_id, v_author, 'upvote')
        ON CONFLICT (post_id, user_id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  -- Accurate vote count for this seed batch
  SELECT count(*)::int INTO v_votes_created
  FROM public.bulletin_votes v
  JOIN public.bulletin_posts p ON p.id = v.post_id
  WHERE p.society_id = v_society
    AND p.structured->>'batch' = 'smart_groups_e2e_400';

  ALTER TABLE public.bulletin_posts ENABLE TRIGGER trg_enforce_bulletin_daily_post_cap;
  ALTER TABLE public.bulletin_comments ENABLE TRIGGER trg_notify_bulletin_comment_reply;

  RAISE NOTICE 'Smart Groups seed done: posts=%, comments=%, votes=%, recommendations=% (total interactions = %)',
    v_posts_created, v_comments_created, v_votes_created, v_recs_created,
    (v_posts_created + v_comments_created + v_votes_created);
END $$;
