import type { LangKey, WwmUrgency } from "./types";

export const WWM_VIBRATION: Record<WwmUrgency, number | number[]> = {
  CLEAR: [0, 40],
  CAUTION: [0, 80, 60, 80],
  STOP: [0, 120, 60, 120, 60, 120],
  DANGER: [0, 600, 200, 600],
};

export const DIALOGUE_PREFIXES: Record<string, Record<LangKey, string>> = {
  ocr_general:      { en: "Sure, let me read that for you.", hi: "बिल्कुल, पढ़ती हूं।", mr: "नक्कीच, वाचते." },
  ocr_medicine:     { en: "Of course. Let me check that medicine.", hi: "बिल्कुल, दवा जांचती हूं।", mr: "नक्कीच, औषध तपासते." },
  ocr_menu:         { en: "Sure, I'll read the menu.", hi: "ज़रूर, मेनू पढ़ती हूं।", mr: "नक्कीच, मेनू वाचते." },
  ocr_prescription: { en: "Of course. Reading the prescription now.", hi: "बिल्कुल, पर्चा पढ़ रही हूं।", mr: "नक्कीच, प्रिस्क्रिप्शन वाचते." },
  ocr_govdoc:       { en: "Sure, let me read that document.", hi: "ज़रूर, दस्तावेज़ पढ़ती हूं।", mr: "नक्कीच, दस्तावेज वाचते." },
  ocr_currency:     { en: "Let me check that note.", hi: "नोट जांचती हूं।", mr: "नोट तपासते." },
  ocr_form:         { en: "Sure, reading that form now.", hi: "ज़रूर, फॉर्म पढ़ती हूं।", mr: "नक्कीच, फॉर्म वाचते." },
  scanning_start:   { en: "Scanning started. I'm looking around for you.", hi: "स्कैनिंग शुरू। देख रही हूं।", mr: "स्कॅनिंग सुरू. पाहत आहे." },
  scanning_stop:    { en: "Scanning stopped. I'm here whenever you need me.", hi: "स्कैनिंग बंद। जब भी जरूरत हो मैं यहां हूं।", mr: "स्कॅनिंग थांबली. जेव्हा गरज असेल मी इथे आहे." },
  listening:        { en: "I'm listening.", hi: "मैं सुन रही हूं।", mr: "मी ऐकत आहे." },
  thinking:         { en: "Thinking...", hi: "सोच रही हूं...", mr: "विचार करत आहे..." },
  recording_now:    { en: "Recording your answer now.", hi: "आपका जवाब रिकॉर्ड हो रहा है।", mr: "तुमचे उत्तर रेकॉर्ड होत आहे." },
  photo_now:        { en: "Got it. Taking photo now.", hi: "ठीक है। तस्वीर ले रही हूं।", mr: "ठीक आहे. फोटो घेते." },
  didnt_hear:       { en: "I didn't quite catch that. Could you say it again?", hi: "ठीक से सुनाई नहीं दिया। फिर कहें?", mr: "नीट ऐकू आले नाही. पुन्हा सांगाल का?" },
  conv_on:          { en: "Conversation mode is on. I'm listening and I'll remember everything. Hold the mic again to stop.", hi: "बातचीत मोड चालू। सुन रही हूं। बंद करने के लिए माइक दबाएं।", mr: "संभाषण मोड चालू. ऐकत आहे. बंद करण्यासाठी मायक दाबा." },
  conv_off:         { en: "Conversation ended. It was lovely talking with you.", hi: "बातचीत बंद। आपसे बात करके अच्छा लगा।", mr: "संभाषण संपले. तुमच्याशी बोलून छान वाटले." },
  memory_cleared:   { en: "Memory cleared. Starting fresh.", hi: "याददाश्त साफ। नए सिरे से।", mr: "स्मृती साफ. नव्याने सुरुवात." },
  fallback:         { en: "I'm here with you. Camera is active.", hi: "मैं आपके साथ हूं।", mr: "मी तुमच्यासोबत आहे." },
  offline_warn:     { en: "No internet connection. I may not respond until you reconnect.", hi: "इंटरनेट नहीं है। जुड़ने पर काम करेगी।", mr: "इंटरनेट नाही. जोडल्यावर काम करेल." },
  wifi_back:        { en: "Internet is back. I'm fully ready now.", hi: "इंटरनेट वापस आ गया। अब तैयार हूं।", mr: "इंटरनेट परत आले. आता तयार आहे." },
  sos_warning:      { en: "SOS mode. Calling emergency contact in 5 seconds. Shake again to cancel.", hi: "SOS मोड। 5 सेकंड में इमरजेंसी कॉल। रद्द करने के लिए हिलाएं।", mr: "SOS मोड. 5 सेकंदात आपत्कालीन कॉल. रद्द करण्यासाठी हलवा." },
  sos_cancelled:    { en: "SOS cancelled. I'm still here with you.", hi: "SOS रद्द। मैं यहां हूं।", mr: "SOS रद्द. मी इथे आहे." },
  sos_set_prompt:   { en: "Please say your emergency contact's phone number now.", hi: "अभी अपने आपातकालीन संपर्क का नंबर बोलें।", mr: "आता तुमच्या आपत्कालीन संपर्काचा नंबर सांगा." },
  sos_set_saved:    { en: "Emergency contact saved. Double shake will call {number}.", hi: "आपातकालीन संपर्क सहेजा। दो बार हिलाने पर {number} पर कॉल होगी।", mr: "आपत्कालीन संपर्क जतन केला. दोनदा हलवल्यावर {number} ला कॉल जाईल." },
  sos_set_failed:   { en: "Couldn't hear the number. Please try again from settings.", hi: "नंबर सुनाई नहीं दिया। सेटिंग्स से फिर कोशिश करें।", mr: "नंबर ऐकू आला नाही. सेटिंग्जमधून पुन्हा प्रयत्न करा." },
  repeat_last:      { en: "Repeating last message.", hi: "पिछला संदेश दोहराती हूं।", mr: "शेवटचा संदेश पुन्हा सांगते." },
  no_repeat:        { en: "Nothing to repeat yet.", hi: "अभी कुछ नहीं है।", mr: "अजून काही नाही." },
  battery_low:      { en: "Warning: battery is low. Please charge soon.", hi: "चेतावनी: बैटरी कम है। चार्ज करें।", mr: "सावधान: बॅटरी कमी आहे. चार्ज करा." },
  wwm_start:        { en: "Walk With Me is on. Walk slowly, I'm watching the path ahead.", hi: "Walk With Me चालू। धीरे चलें, आगे का रास्ता देख रही हूं।", mr: "Walk With Me सुरू. हळू चाला, पुढचा रस्ता पाहत आहे." },
  wwm_stop:         { en: "Walk With Me is off. You walked safely. Well done.", hi: "Walk With Me बंद। आप सुरक्षित चले। शाबाश।", mr: "Walk With Me बंद. तुम्ही सुरक्षित चाललात. शाब्बास." },
  wwm_resume:       { en: "Resuming path watch.", hi: "रास्ता देखना फिर शुरू।", mr: "मार्ग पाहणे पुन्हा सुरू." },
  wwm_elevation:    { en: "Elevation change ahead, step carefully.", hi: "आगे ऊंचाई बदल रही है, सावधानी से कदम रखें।", mr: "पुढे उंची बदलत आहे, सावधानपणे पाऊल टाका." },
  no_api_key:       { en: "API keys are missing. Please check your app configuration and restart with npx expo start --clear.", hi: "API keys नहीं हैं। app.config.js जांचें और npx expo start --clear चलाएं।", mr: "API keys नाहीत. app.config.js तपासा आणि npx expo start --clear चालवा." },
  wwm_api_error:    { en: "Walk With Me paused due to connection issues. Please check your internet and API keys.", hi: "कनेक्शन समस्या के कारण Walk With Me रुका। इंटरनेट और API keys जांचें।", mr: "कनेक्शन समस्येमुळे Walk With Me थांबले. इंटरनेट आणि API keys तपासा." },
};

export const D = (key: string, lang: LangKey): string =>
  DIALOGUE_PREFIXES[key]?.[lang] ?? DIALOGUE_PREFIXES[key]?.en ?? "";

export const FACE_STRINGS: Record<string, Record<LangKey, string>> = {
  askName:            { en: "Who is this person? Please say their name now.", hi: "यह कौन है? नाम बोलें।", mr: "हा कोण आहे? नाव सांगा." },
  takingPhoto:        { en: "Got it. Now taking a photo to remember them.", hi: "ठीक है। तस्वीर ले रही हूं।", mr: "ठीक आहे. फोटो घेते." },
  faceSaved:          { en: "I'll remember {name} for you from now on.", hi: "मैं अब से {name} को याद रखूंगी।", mr: "मी आता {name} ला लक्षात ठेवेन." },
  faceNotHeard:       { en: "I couldn't catch the name. Please triple tap and try again.", hi: "नाम सुनाई नहीं दिया। फिर कोशिश करें।", mr: "नाव ऐकू आले नाही. पुन्हा प्रयत्न करा." },
  faceDescFailed:     { en: "Couldn't capture the face clearly. Please try again in better light.", hi: "चेहरा स्पष्ट नहीं था। अच्छी रोशनी में फिर कोशिश करें।", mr: "चेहरा स्पष्ट नव्हता. चांगल्या प्रकाशात पुन्हा प्रयत्न करा." },
  maxFaces:           { en: "You've already saved 10 people. Please delete one first.", hi: "10 लोग याद हैं। पहले एक हटाएं।", mr: "10 लोक आधीच आहेत. एकाला काढा." },
  faceManageList:     { en: "Face management. Your saved people are: {list}. Say a number to delete that person. Shake to go back.", hi: "चेहरा प्रबंधन। लोग: {list}। नंबर बोलें हटाने के लिए।", mr: "चेहरा व्यवस्थापन. लोक: {list}. नंबर बोला काढण्यासाठी." },
  faceManageEmpty:    { en: "No faces saved yet. Shake to go back.", hi: "कोई चेहरा नहीं बचाया। हिलाएं।", mr: "अजून कोणाचा चेहरा नाही. हलवा." },
  faceDeleteAsk:      { en: "Delete {name}? Tap once to confirm. Double tap to cancel.", hi: "{name} हटाएं? एक बार हां, दो बार नहीं।", mr: "{name} काढायचे? एकदा होय, दोनदा नाही." },
  faceDeleted:        { en: "{name} has been removed.", hi: "{name} को हटा दिया।", mr: "{name} काढले." },
  faceDeleteCancelled:{ en: "Cancelled. {name} is still saved.", hi: "रद्द। {name} अभी भी याद है।", mr: "रद्द. {name} अजून आहे." },
  sayNumber:          { en: "Please say the number of the person you want to delete.", hi: "नंबर बोलें।", mr: "नंबर बोला." },
  numberNotHeard:     { en: "Couldn't hear the number. Please try again.", hi: "नंबर नहीं सुना। फिर कोशिश करें।", mr: "नंबर ऐकू आला नाही. पुन्हा प्रयत्न करा." },
  invalidNumber:      { en: "That number isn't in the list. Please say a number between 1 and {max}.", hi: "यह नंबर नहीं है। 1 से {max} के बीच बोलें।", mr: "हा नंबर नाही. 1 ते {max} मध्ये बोला." },
  settingsOpen:       { en: "Settings open. Tap once for female voice. Double tap for male voice. Triple tap to manage saved faces. Shake to close.", hi: "सेटिंग्स। एक बार महिला। दो बार पुरुष। तीन बार चेहरा। हिलाएं बंद।", mr: "सेटिंग्स. एकदा महिला. दोनदा पुरुष. तीनदा चेहरा. हलवा बंद." },
  femaleSelected:     { en: "Female voice selected.", hi: "महिला आवाज़ चुनी।", mr: "महिला आवाज निवडला." },
  maleSelected:       { en: "Male voice selected.", hi: "पुरुष आवाज़ चुनी।", mr: "पुरुष आवाज निवडला." },
  settingsClosed:     { en: "Settings closed. Tap to start scanning whenever you're ready.", hi: "सेटिंग्स बंद। जब चाहें स्कैन करें।", mr: "सेटिंग्स बंद. तयार असाल तेव्हा स्कॅन करा." },
};

export const FS = (key: string, lang: LangKey, replace?: Record<string, string>): string => {
  let value = FACE_STRINGS[key]?.[lang] ?? FACE_STRINGS[key]?.en ?? "";
  if (replace) {
    Object.entries(replace).forEach(([token, replacement]) => {
      value = value.replace(`{${token}}`, replacement);
    });
  }
  return value;
};
