# Cleaner City - Release Checklist

**Audit:** CC-UX-PROD-20261110  
**Current decision:** **NOT PRODUCTION READY**

## Mandatory before PRODUCTION READY

- [ ] Redesign committed, reviewed, and deployed to the target environment  
- [ ] Dual-account host/guest E2E PASS with DB evidence (publish→request→accept→OTP→start→complete)  
- [ ] Seat concurrency last-seat PASS on current RPCs  
- [ ] Fresh RLS outsider JWT penetration PASS  
- [ ] YourRidesBoard behaviours restored or explicitly replaced and tested  
- [ ] Push: foreground + background + closed-app evidence (or documented supported limitation)  
- [ ] Android dogfood of tracking / permissions  
- [ ] SOS path honest when SMS/relay missing; no false “calling emergency services” claims  
- [ ] Fuel path tested with **test** Razorpay credentials only (or feature-flagged off)  
- [ ] `npx vitest run src/test/cleaner-city` green on release SHA  
- [ ] Production build + app store binary (if mobile) stamped to same SHA  

## Completed this run

- [x] Feature inventory of redesign vs prior  
- [x] Find swap control  
- [x] Match card honesty/enrichment regressions fixed  
- [x] Safety/OTP honesty strings restored  
- [x] Vitest Cleaner City suite 221/221  
- [x] Schema RLS inventory (tables enabled)  
- [x] Edge function inventory for Cleaner City  

## Explicit non-claims

- [ ] Not claiming PRODUCTION READY  
- [ ] Not claiming device push  
- [ ] Not claiming dual-user live lifecycle PASS  
- [ ] Not claiming www.sociva.in already serves this uncommitted redesign  
