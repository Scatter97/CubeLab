1. Welcome setup doesn't have the same logo as timer and the real logo
2. Import from Cstimer option says "Drop a csTimer `.txt` or `.json` file here, or choose one." and "Up to 10 MB. Sessions are appended; existing CubeLab data and settings are kept." Cstimer Only exports in txt so no need for .json. we should remove the "Up to 10 MB. Sessions are appended; existing CubeLab data and settings are kept." warning that isn't important
3. setup cubelab page has warning "This is the session CubeLab opens first. You can change it anytime."  remove it
4. default wca inspection to on
5. explain quick standard  and Delibrate label with seconds, allow custom user time. as well add little hold to start testing area so if the user selects an option they can press space and test it
6. add an option to not display even seconds  in Timer display
7. remove appearence from the number 2 settings screen make it 3 and make sync 4
8. in page 3 appearence, user should be able change colors there keep the defaults light dark and system, and allow custom aceent color and whatever colors diffrent colors we use, and background color, and like something like hold to activate timer colors. 
9. add the feature #8 in the settings menu
10. better designed turn on sync screen, make the buttons connect with google and maybe lator big remove the text "Keep your solves and settings backed up and synchronized across your devices. Connect Google Drive to back up this setup." 
11. your are all set screen should have a dismiss button like a skip button and show time should decrease to 2 seconds
12. session selector appears under parts of the ui(please inspect you self)
13. Improve the drage and reorder for sessions selector to really move the sessions visaully not just show the line 
14. remove buttons to reorder session 
15. create new session text box behavoir defualt set name shoulden't be grey it should be there and when the user presses it should select all, so the user can replace
16. practice and compition buttons should be placed at beterr spots and remove clarifying text "Solves fill WCA-style rounds automatically. The format is fixed for this session." add a hoverable ? that explains what the sesssion types do, place it near the session type test
17. compitition trimming should follow user set trimming in settings 
18. round format drop down should be greyd out if practice is selected no dissapeer, round format  drop down should only say short form like ao5  and bo3 etc.
19. the left of the two drop downs and the name text box should allign for a cleaner ui
20. remove "Nothing is saved until you create the session."
21. remove "Name, event, and essential session behavior"
22. remove session renamer button from session panel session settings should follow the same layout as session creator, 
23. remove custom event support make sync make all events not sopported by putting them in a MISC category with no scramble.
24. If scramble fails to generate please make a error emssage along with a button to regenerate
25. increase defualt tool panel size
26. in analytics pressing customshould bring up like a calender that floats to select not add adtional dropdowns for the user, the callender should be themed
27. update version number to 0.01.261121:1
28. update agent md file to include the following version number update santax x.xx.YYMMDD:Nth patch from that day. update patch for small bug fixes, and update main version numbers when features get added. do not bump first number without admin approval
29. skeleton screen for analytics loading no more loading circle
30. loading training text should be removed, find out what it's loading if possible make all of the loading happen after the user pressed begin practice, then pring up a skelton screen of the timer when that loads
31. rename begin practice button to begin training
32. merge training settings with normal settings.
33. training hub should use the same custom dropdowns as othe rpages
34. currently: ## PLL Recognition statistics,## OLL Execution statistics,## OLL Recognition statistics, and ## PLL Execution statistics only show up when it's selected in the session setup panel, rework that to one panel with 2 switches to swith between oll and pll and execution and recognition
35. add next to recognition in the drop down (BETA)
36. move beta text out of logo move it to the bottom right of the site title cubelab 
37. remove "Select one case for execution or two for recognition. Each needs a usable algorithm. Case selection is a draft and applies with **Apply selection**. Algorithm, difficult-case and preset changes save immediately." 
38. temp  remove  all mentions of the algorithm tracking feature from website(do not permentaly remove will reimplemnt) disable the feature all together including tracking and analytics, algs will be case only for now, do not include it in the website as greyd out, just remove it(temp).
39. remove"Destructive maintenance with typed confirmation"
40. remove advanced pill next to devloper options
41. make sure version in settings also gets changed
42. remove "Data Local-first · no accounts or telemetry Offline Installable PWA with offline scrambles"
43. remove "Changes save automatically."
44. on first open of the draw scramble tool either from dropdown or from the tool panel show button, add a switch that asks the user 2d net or 3d cube
45. inspect cstimer tool panel features, I would like the following added confime time, statistics, time destribution daily stats, metronome, and online battle feature. Please reffer to cstimer's implementations and improve upon it. IMPORTANT online battle shouldn't require a back end server. should be like player create rooms and another person types in the room ID and password. also in metronum remove bpm not needed
46. Test 100k plus solves
47. Test 100 sessions
48. record latencies on the production localhost website for timer stop
49. optimize latency by making things work fast and sync afterwards in background.(espeicailly for google drive sync every solve)
50. default google drive sync every x solve to 10 solves, and 5 minutes