# VideoProducer.jsx Changes for URL Logging

## Change 1: Create jobId at Step 1 (translate), not Step 5

Find the line where `assemblyJobId` is set inside `handleAssemble()`:
```js
const jobId = `vf-${Date.now()}`;
setAssemblyJobId(jobId);
```

Move this logic UP to the beginning of `handleTranslate()` (Step 1).
Add this at the very top of the handleTranslate function:
```js
const handleTranslate = () => {
  // Create the jobId NOW so URLs can be logged from the start
  const newJobId = `vf-${Date.now()}`;
  setAssemblyJobId(newJobId);
  // ... rest of existing translate logic
};
```

## Change 2: Pass jobId to both polling loops

### In the image polling interval (Step 4):
Change:
```js
const result = await checkJobs(imageJobsRef.current, session);
```
To:
```js
const result = await checkJobs(imageJobsRef.current, session, assemblyJobId);
```

### In the animation polling interval (Step 4→5):
Change:
```js
const result = await checkJobs(jobs, session);
```
To:
```js
const result = await checkJobs(jobs, session, assemblyJobId);
```

## Change 3: Add "Recover URLs" button to Job Log / Step 5

Add this button in the Step 5 UI near the Save/Export buttons:
```jsx
<button
  onClick={async () => {
    try {
      const log = await getUrlLog(assemblyJobId, session);
      console.log("Recovered URLs:", log);
      // Restore image URLs
      if (log.images) {
        const recovered = Object.entries(log.images)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, url]) => url);
        setImages(recovered);
      }
      // Restore animation URLs
      if (log.animations) {
        setAnimationUrls(log.animations);
      }
      alert(`Recovered ${log.count} URLs from log!`);
    } catch (err) {
      alert("Could not recover URLs: " + err.message);
    }
  }}
  style={{ background: "#2D3147", color: "#C9973A", border: "1px solid rgba(201,151,58,0.3)", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
>
  🔁 Recover URLs from Log
</button>
```

## Summary of files to update in GitHub:
1. `netlify/functions/check-jobs.js` → replace with the new version
2. `netlify/functions/log-url.js` → NEW file (add to functions folder)
3. `netlify/functions/get-url-log.js` → NEW file (add to functions folder)
4. `src/lib/api.js` → update checkJobs signature + add getUrlLog
5. `src/pages/VideoProducer.jsx` → 3 small changes above
