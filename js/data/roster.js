// Synthetic roster for the mentor workspace: four coaching batches whose students carry realistic
// names from across India. Everything is seeded, so the same students (with the same rolls, consent
// choices and hidden traits) appear on every load. Only the mock dates follow the calendar: four
// weekly mocks, the latest two days ago.
import { rng, hashStr, clamp } from '../ui.js';

const DAY = 86400000;
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// Name pools by region: given names by gender, family names (by gender where they differ).
// w is the rough share of a national coaching intake. `mohd` covers "Mohammed Faiz"-style names.
const REGIONS = [
  { id: 'hindi', w: 20,
    m: 'Aarav, Aditya, Arjun, Rohan, Kunal, Harsh, Ankit, Shivam, Abhishek, Yash, Siddharth, Utkarsh, Ayush, Pranav, Nikhil, Saurabh, Akash, Kartik, Anmol, Manav, Tanmay, Lakshya, Parth, Vaibhav, Ishaan, Devansh, Rudra, Aryan, Shaurya, Divyansh, Anurag, Prakhar, Satyam, Shubham, Raghav, Vedant',
    f: 'Ananya, Aditi, Riya, Sakshi, Shreya, Kavya, Isha, Muskan, Khushi, Nandini, Tanvi, Vaishnavi, Anjali, Aanya, Divya, Neha, Shruti, Pragya, Garima, Mansi, Aarohi, Shivangi, Ritika, Palak, Anushka, Srishti, Akanksha, Prachi, Kritika, Saumya, Tanya, Vanshika, Diksha',
    last: 'Sharma, Verma, Gupta, Mishra, Pandey, Tiwari, Yadav, Chauhan, Srivastava, Agarwal, Saxena, Dubey, Shukla, Tripathi, Awasthi, Rawat, Negi, Bisht, Tyagi, Kashyap, Goel, Bansal, Mittal, Rastogi, Bajpai, Dwivedi, Chaturvedi, Rajput, Singh, Chaudhary, Maurya, Pal' },
  { id: 'bihar', w: 10,
    m: 'Aman, Ritesh, Saurav, Prince, Amit, Rajeev, Vikash, Abhinav, Shashank, Aditya, Ankit, Rishav, Sumit, Gaurav, Rahul, Kundan, Piyush, Raushan, Harshit, Ujjwal, Anand, Mayank',
    f: 'Anshika, Shalini, Pallavi, Shivani, Nikita, Puja, Ruchi, Priyanka, Sneha, Nisha, Khushboo, Swati, Jyoti, Riya, Komal, Shreya, Sweta, Supriya, Aditi, Kajal',
    lastM: 'Kumar, Kumar, Jha, Sinha, Prasad, Thakur, Choudhary, Mishra, Yadav, Singh, Pandey, Ojha, Pathak, Rai, Raj, Ranjan, Mahto, Mandal, Kushwaha, Sahni',
    lastF: 'Kumari, Kumari, Jha, Sinha, Prasad, Thakur, Choudhary, Mishra, Yadav, Singh, Pandey, Ojha, Pathak, Rai, Bharti, Kushwaha' },
  { id: 'rajasthan', w: 5,
    m: 'Lokesh, Hemant, Himanshu, Mayank, Tushar, Kshitij, Rajat, Chirag, Bhavesh, Vikram, Mohit, Dhruv, Yuvraj, Jayant, Naman, Devendra, Pratap',
    f: 'Bhumika, Payal, Mahima, Chanchal, Ekta, Kritika, Tanisha, Nikita, Garima, Diksha, Rashmi, Prerna, Harshita, Jhanvi, Kirti',
    last: 'Rathore, Shekhawat, Choudhary, Meena, Jain, Agarwal, Purohit, Vyas, Bishnoi, Jangid, Soni, Saini, Kumawat, Mathur, Sharma, Bhati, Rajpurohit, Gehlot' },
  { id: 'punjab-sikh', w: 3.5,
    m: 'Gurkaran, Jaskaran, Karanveer, Taranjit, Jashandeep, Angad, Fateh, Arjan, Sukhman, Rajveer, Harkirat, Manveer, Gurveer, Ekamjot',
    f: 'Gurleen, Harleen, Jasleen, Prabhleen, Sukhmani, Mehak, Jasnoor, Navneet, Avneet, Ravneet, Manleen, Simran, Gurneet',
    lastM: 'Singh, Singh, Singh, Gill, Sandhu, Dhillon, Sidhu, Grewal, Brar, Bajwa, Randhawa, Virk, Cheema, Bains',
    lastF: 'Kaur, Kaur, Kaur, Gill, Sandhu, Dhillon, Sidhu, Grewal, Brar, Bajwa, Randhawa, Virk, Cheema, Bains' },
  { id: 'punjab', w: 3,
    m: 'Kabir, Rishabh, Arnav, Ishaan, Karan, Varun, Aryan, Sahil, Rohan, Tushar, Dhruv, Nakul, Raghav, Akshit, Kunal, Madhav, Vansh',
    f: 'Simran, Mehak, Ishita, Tanya, Kriti, Navya, Riya, Sanya, Kashish, Gunjan, Bhavya, Jasmine, Aashna, Tanvi, Ira',
    last: 'Malhotra, Kapoor, Khanna, Arora, Mehra, Bhatia, Sethi, Chopra, Ahuja, Kohli, Bedi, Tandon, Grover, Taneja, Sabharwal, Chawla, Kalra, Wadhwa, Batra, Narang, Juneja, Dhawan, Sachdeva, Anand' },
  { id: 'haryana', w: 2.5,
    m: 'Sahil, Mohit, Deepak, Ankit, Nitin, Lakshay, Naveen, Vishal, Rahul, Tarun, Jatin, Pawan, Himanshu, Aman, Vikas, Sumit',
    f: 'Sakshi, Neha, Pooja, Komal, Nisha, Tanu, Jyoti, Manisha, Kajal, Preeti, Ritu, Muskan, Khushi, Anjali',
    last: 'Malik, Dahiya, Sangwan, Hooda, Dalal, Rathi, Ahlawat, Sheoran, Kadian, Punia, Dhankhar, Beniwal, Jakhar, Lather, Saini, Yadav, Rana' },
  { id: 'bengal', w: 8,
    m: 'Arnab, Sayan, Soumya, Ritwik, Debayan, Anirban, Subhajit, Arijit, Rajdeep, Sourav, Abhirup, Pritam, Dipanjan, Shubham, Rohan, Aritra, Sagnik, Ankan, Swarnava, Rishav, Agnibha, Shounak, Debarshi, Indranil',
    f: 'Ishita, Moumita, Sreeja, Ankita, Payel, Rituparna, Debolina, Srijita, Tanushree, Oindrila, Sohini, Trisha, Aishani, Ahana, Rupsa, Sanchari, Ananya, Riddhima, Shreyasi, Adrija, Sayantika, Poulami, Arpita',
    last: 'Banerjee, Chatterjee, Mukherjee, Das, Ghosh, Bose, Sen, Dutta, Roy, Saha, Chakraborty, Bhattacharya, Sarkar, Paul, Mondal, Biswas, Majumdar, Sengupta, Basu, Mitra, Guha, Pal, Dey, Nandi, Kar' },
  { id: 'maharashtra', w: 8,
    m: 'Omkar, Siddhesh, Aniket, Pratik, Tejas, Sahil, Chinmay, Atharva, Vedant, Soham, Saurabh, Rushikesh, Yash, Aditya, Shreyas, Pranav, Mihir, Ninad, Ojas, Sarthak, Kunal, Abhay, Parth',
    f: 'Sneha, Sayali, Gauri, Mrunal, Prachi, Rutuja, Shravani, Tanaya, Ketaki, Aishwarya, Sanika, Apurva, Gargi, Isha, Rasika, Siddhi, Janhavi, Vaidehi, Manasi, Sakshi, Mitali, Anuja',
    last: 'Patil, Deshmukh, Kulkarni, Joshi, Pawar, Jadhav, Shinde, Gokhale, Bhosale, Chavan, More, Deshpande, Gaikwad, Kale, Sawant, Naik, Wagh, Phadke, Apte, Gadgil, Kadam, Salunkhe, Mane, Kamble, Thorat' },
  { id: 'gujarat', w: 5,
    m: 'Dhruv, Jay, Harsh, Meet, Parth, Krish, Yash, Hemang, Nisarg, Kavan, Om, Vatsal, Jainil, Tirth, Smit, Deep, Het, Rudra, Prem, Neel, Kunj, Darshil',
    f: 'Khushi, Dhruvi, Hetvi, Krupa, Jinal, Nidhi, Riddhi, Pooja, Mansi, Zeel, Ishani, Foram, Devanshi, Bansari, Khyati, Prisha, Kinjal, Shruti, Hetal, Vidhi, Nirali',
    last: 'Patel, Patel, Shah, Mehta, Desai, Parekh, Trivedi, Joshi, Panchal, Bhatt, Vyas, Chauhan, Solanki, Thakkar, Dave, Pandya, Raval, Parmar, Gohil, Prajapati, Doshi, Sheth' },
  { id: 'tamil', w: 7,
    m: 'Karthik, Arun, Vignesh, Pradeep, Hari, Surya, Gokul, Ashwin, Naveen, Dinesh, Sanjay, Bharath, Vishal, Sriram, Aravind, Kishore, Harish, Balaji, Mukilan, Nithish, Sudharsan, Kavin, Yuvan, Adithya, Santhosh, Gowtham',
    f: 'Priya, Divya, Keerthana, Swathi, Janani, Harini, Nivetha, Sowmya, Lakshmi, Aishwarya, Kavya, Deepika, Abinaya, Meenakshi, Sandhya, Pavithra, Dharshini, Monisha, Yazhini, Varsha, Madhumitha, Shalini, Sruthi, Ananya, Nandhini, Akshaya',
    last: 'Iyer, Krishnan, Subramanian, Raman, Venkatesan, Murugan, Natarajan, Rajan, Sundaram, Srinivasan, Narayanan, Chandrasekaran, Ramesh, Selvam, Pandian, Raghavan, Ganesan, Arumugam, Shanmugam, Balasubramanian, Iyengar, Ravichandran, Kannan, Mohan, Elangovan, Saravanan' },
  { id: 'kerala', w: 3.5,
    m: 'Arjun, Vishnu, Akhil, Sreehari, Abhijith, Midhun, Aswin, Sidharth, Gautham, Anand, Adarsh, Rahul, Hrishikesh, Sreeram, Govind, Advaith, Karthik, Navaneeth, Abhinav, Vaishakh, Arun',
    f: 'Anjali, Aparna, Athira, Gopika, Sreelakshmi, Devika, Meera, Lakshmi, Nandana, Aiswarya, Sruthi, Parvathy, Gayathri, Krishnapriya, Aswathy, Arya, Sreya, Malavika, Anagha, Niranjana, Priya, Revathy',
    last: 'Nair, Nair, Menon, Menon, Pillai, Kurup, Panicker, Namboothiri, Warrier, Nambiar, Krishnan, Unnithan, Varma, Kaimal, Thampi' },
  { id: 'kerala-christian', w: 2,
    m: 'Abel, Jobin, Albin, Sebin, Tom, Jeswin, Alan, Ebin, Aaron, Joel, Basil, Christy, Jerin, Anto, Felix, Nevin, Allen',
    f: 'Anna, Neethu, Teena, Sherin, Merin, Jisha, Jincy, Riya, Elsa, Rose, Liya, Diya, Christeena, Alna, Aleena, Sneha, Ann Mary, Mariya',
    last: 'Thomas, Joseph, Mathew, Varghese, Kurian, George, Jacob, Chacko, Philip, Abraham, John, Cherian, Antony, Sebastian, Paul, Mathai' },
  { id: 'telugu', w: 7,
    m: 'Sai Teja, Venkat, Charan, Rohith, Abhiram, Pavan, Harsha, Srikanth, Vamsi, Kiran, Manikanta, Tarun, Karthikeya, Aditya, Rishi, Sandeep, Akhil, Sathvik, Varun, Praneeth, Karthik, Teja, Sai Kiran, Nikhil, Lokesh',
    f: 'Sravani, Harika, Lahari, Divya, Bhavana, Keerthi, Sahithi, Pranathi, Navya, Varsha, Sindhu, Mounika, Deepthi, Sreeja, Akshaya, Tejaswini, Hasini, Sanjana, Bhargavi, Likhitha, Vaishnavi, Manasa',
    last: 'Reddy, Reddy, Rao, Naidu, Chowdary, Varma, Raju, Goud, Prasad, Sastry, Yadav, Murthy, Achari, Gupta, Kumar' },
  { id: 'kannada', w: 4,
    m: 'Prajwal, Chethan, Manoj, Suhas, Rakesh, Akshay, Nithin, Shreyas, Varun, Sagar, Shashank, Karthik, Tejas, Dhanush, Pruthvi, Ullas, Vinay, Srujan, Gagan, Abhishek, Pranav',
    f: 'Spoorthi, Bhoomika, Chaitra, Kavana, Prakruthi, Ananya, Sahana, Pallavi, Shreya, Rashmi, Nisha, Deeksha, Varsha, Kavya, Ramya, Sinchana, Thanmayi, Apeksha, Nayana, Vibha, Rakshitha, Disha',
    last: 'Gowda, Gowda, Hegde, Shetty, Rao, Bhat, Kamath, Pai, Shenoy, Kulkarni, Nayak, Acharya, Poojary, Karanth, Murthy, Shastry, Hebbar, Upadhyaya' },
  { id: 'odisha', w: 3.5,
    m: 'Subham, Sourav, Debasish, Abinash, Biswajit, Satyajit, Swagat, Pritiranjan, Sambit, Ansuman, Abhisek, Saswat, Prateek, Bikash, Om',
    f: 'Subhashree, Sasmita, Smruti, Lopamudra, Sonali, Ipsita, Barsha, Sweta, Anwesha, Archita, Madhusmita, Sushree, Debasmita, Rashmita, Itishree, Lipsa',
    last: 'Mohanty, Patnaik, Mishra, Panda, Sahoo, Behera, Nayak, Jena, Das, Pradhan, Swain, Rout, Mohapatra, Parida, Senapati, Dash, Samal, Biswal, Tripathy, Acharya' },
  { id: 'muslim', w: 9,
    m: 'Ayaan, Faizan, Zaid, Arshad, Sameer, Rehan, Danish, Saif, Tabish, Adnan, Irfan, Junaid, Huzaifa, Arham, Shoaib, Farhan, Talha, Rayyan, Azaan, Anas, Hamza, Faiz, Rizwan, Sufiyan, Nabeel, Aqib, Usman, Zubair, Kashif, Owais',
    f: 'Ayesha, Fatima, Zoya, Sana, Alisha, Mehreen, Iqra, Nazia, Areeba, Anam, Zainab, Hiba, Mariyam, Sadia, Afreen, Bushra, Rida, Alina, Inaya, Sumaiya, Uzma, Nida, Saniya, Shifa, Tasneem, Heena',
    last: 'Khan, Khan, Ansari, Qureshi, Siddiqui, Shaikh, Sheikh, Syed, Hussain, Rizvi, Farooqui, Pathan, Mirza, Hashmi, Naqvi, Rahman, Ali, Akhtar, Malik, Usmani, Warsi, Kazmi, Zaidi, Baig, Momin',
    mohd: { p: 0.25, first: 'Mohammed, Mohammed, Mohd, Muhammed', last: 'Faiz, Anas, Nabeel, Sufiyan, Arif, Zaid, Hamza, Rayyan, Talha, Shahid, Adil, Ashraf, Ayaan, Fahad, Ibrahim' } },
  { id: 'assam', w: 2.5,
    m: 'Bikash, Pranjal, Hrishikesh, Abhijit, Debajit, Parag, Dhrubajyoti, Manash, Partha, Kaushik, Rupam, Bitupan, Anurag, Jyotirmoy, Hiranya, Ankur, Nilotpal, Arnab',
    f: 'Pallabi, Jahnavi, Bornali, Trishna, Dikshita, Nilakshi, Ankita, Priyanka, Bhaswati, Rimjhim, Mrinmoyee, Kangkana, Barnali, Chayanika, Ritusmita, Jinia, Debasmita',
    last: 'Baruah, Gogoi, Bora, Saikia, Hazarika, Kalita, Deka, Sarma, Phukan, Choudhury, Bhuyan, Nath, Medhi, Borthakur, Mahanta, Konwar, Rajkhowa, Dutta' },
  { id: 'himalayan', w: 1.5,
    m: 'Tenzin, Pemba, Sonam, Karma, Nima, Dawa, Jigme, Ngawang, Lobsang, Norbu, Tashi, Kunga, Palden, Phurba, Mingma, Ugyen',
    f: 'Dolma, Yangchen, Lhamo, Diki, Choden, Yangzom, Dolkar, Wangmo, Pema, Dechen',
    lastM: 'Dorje, Bhutia, Lepcha, Sherpa, Tamang, Gurung, Namgyal, Lama, Wangchuk, Rai, Subba, Limbu, Tsering, Thapa',
    lastF: 'Bhutia, Lepcha, Sherpa, Tamang, Gurung, Lama, Rai, Subba, Limbu, Thapa, Dolma, Lhamo' },
  { id: 'mizo', w: 0.8,
    m: 'Lalremruata, Lalthansanga, Vanlalruata, Zothanpuia, Lalhmingsanga, Lalnunmawia, Malsawmkima, Lalrinfela',
    f: 'Lalrinpuii, Vanlalhriatpuii, Zothansangi, Malsawmtluangi, Lalhmangaihzuali, Laldinpuii, Lalnunpuii, Vanlalruati',
    last: 'Ralte, Pachuau, Hmar, Colney, Sailo, Chhangte, Khiangte, Fanai, Hnamte, Renthlei' },
  { id: 'konkan-christian', w: 1.5,
    m: 'Joel, Ryan, Aaron, Nathan, Clinton, Jovin, Shawn, Alston, Melvin, Gavin, Reuben, Joshua, Neil, Glen, Royston, Brandon',
    f: 'Sharon, Alisha, Joanna, Rhea, Sonia, Melissa, Natasha, Fiona, Tanya, Michelle, Sheryl, Leona, Shanelle, Rochelle, Valerie',
    last: "D'Souza, Fernandes, Pereira, Rodrigues, D'Costa, Pinto, Lobo, Gonsalves, Noronha, Saldanha, Menezes, Colaco, D'Mello, Furtado, Rebello, Vaz, Dias, Cardozo, Mascarenhas" },
  { id: 'kashmir', w: 0.8,
    m: 'Faisal, Owais, Umar, Aqib, Mudasir, Tariq, Basit, Zubair, Uzair, Faizan, Suhail, Arsalan, Ishfaq, Danish',
    f: 'Mehvish, Iqra, Insha, Nida, Saima, Rafia, Ruqaya, Mehak, Bisma, Sabreen, Areej, Afshan',
    last: 'Bhat, Dar, Lone, Wani, Mir, Shah, Malik, Rather, Ganai, Sofi, Khan, Qadri, Bukhari, Peer, Kirmani' },
  { id: 'kashmiri-pandit', w: 0.4,
    m: 'Aditya, Varun, Ishan, Siddharth, Vivek, Kunal, Arnav, Rishi',
    f: 'Shivani, Megha, Aditi, Shreya, Ishita, Ragini, Neha, Sakshi',
    last: 'Kaul, Raina, Dhar, Tikoo, Razdan, Pandita, Bhan, Zutshi, Ganjoo, Kachru, Koul' },
  { id: 'adivasi', w: 1.5,
    m: 'Abhishek, Niraj, Sushil, Ajit, Vikas, Deepak, Manish, Ranjit, Suraj, Prince, Aman, Rohan, Anmol, Bipin',
    f: 'Anima, Neha, Prerna, Pooja, Priyanka, Nikita, Sapna, Shweta, Ankita, Rashmi, Archana, Sweety, Asha, Reshma',
    last: 'Soren, Murmu, Hansda, Tudu, Marandi, Hembrom, Oraon, Munda, Tirkey, Ekka, Toppo, Lakra, Kujur, Minz, Kerketta, Barla, Tigga, Xalxo, Lugun' },
  { id: 'sindhi', w: 0.8,
    m: 'Jatin, Karan, Nikhil, Vinay, Rohan, Kunal, Gaurav, Mohit, Bharat, Raj, Hitesh, Varun',
    f: 'Komal, Simran, Bhavna, Jyoti, Divya, Riya, Kajal, Tina, Nisha, Kashish, Pooja',
    last: 'Lalwani, Chandnani, Kriplani, Motwani, Wadhwani, Hemnani, Mulchandani, Keswani, Sadhwani, Gidwani, Nankani, Valecha, Jethwani, Advani, Rupani' },
  { id: 'jain', w: 1.5,
    m: 'Rishabh, Arihant, Sanyam, Parshva, Moksh, Vardhan, Nemish, Aagam, Shrey, Abhay, Akshat, Naman, Tanish, Pranit',
    f: 'Siddhi, Ritika, Saloni, Disha, Jinal, Prachi, Riya, Khushi, Mahi, Palak, Anvi, Ishika, Kriti, Shreya',
    last: 'Jain, Jain, Bothra, Golecha, Surana, Kothari, Lodha, Bafna, Baid, Sancheti, Dugar, Chordia, Bhandari, Kankaria, Sethia, Mehta, Shah' },
].map((g) => ({
  id: g.id, w: g.w, m: list(g.m), f: list(g.f),
  lastM: list(g.lastM || g.last), lastF: list(g.lastF || g.last),
  mohd: g.mohd ? { p: g.mohd.p, first: list(g.mohd.first), last: list(g.mohd.last) } : null,
}));
const TOTAL_W = REGIONS.reduce((s, g) => s + g.w, 0);

// Full names that belong to well-known people (sport, film, politics, business) are re-drawn.
const AVOID = new Set(list(`Ananya Pandey, Shivam Dubey, Ayush Sharma, Divya Agarwal, Kartik Tyagi, Neha Sharma, Anushka Sharma, Tanya Sharma,
  Abhishek Sharma, Ankit Tiwari, Siddharth Shukla, Amit Kumar, Sweta Singh, Anand Kumar, Priyanka Choudhary, Ritesh Pandey, Shalini Pandey,
  Supriya Pathak, Jyoti Kumari, Komal Jha, Vikram Rathore, Mahima Choudhary, Mohit Sharma, Rajat Sharma, Kritika Choudhary, Avneet Kaur,
  Navneet Kaur, Jasleen Kaur, Simran Kaur, Fateh Singh, Arjan Singh, Jaskaran Singh, Harkirat Singh, Taranjit Singh, Taranjit Sandhu,
  Varun Dhawan, Kabir Bedi, Sanya Malhotra, Karan Mehra, Rohan Mehra, Rohan Kapoor, Kunal Kapoor, Sahil Anand, Sakshi Malik, Deepak Hooda,
  Deepak Punia, Mohit Ahlawat, Sumit Malik, Sumit Sangwan, Lakshay Sheoran, Anirban Bhattacharya, Ishita Dutta, Rituparna Sengupta,
  Payel Sarkar, Sohini Sarkar, Debolina Dutta, Pritam Chakraborty, Indranil Sengupta, Ananya Chatterjee, Ritwik Chakraborty, Tanushree Dutta,
  Arpita Ghosh, Sayantika Banerjee, Adrija Roy, Riddhima Ghosh, Oindrila Sen, Soumya Sarkar, Rajdeep Roy, Gauri Shinde, Sneha Wagh,
  Manasi Joshi, Rasika Joshi, Mrunal Kulkarni, Parth Pawar, Saurabh Gokhale, Jay Shah, Jay Mehta, Mansi Parekh, Kinjal Dave, Nidhi Shah,
  Vidhi Pandya, Ashwin Ravichandran, Sanjay Subramanian, Priya Raman, Janani Iyer, Sriram Krishnan, Aravind Srinivas, Aravind Srinivasan,
  Balaji Srinivasan, Santhosh Narayanan, Gautham Menon, Lakshmi Menon, Parvathy Menon, Anjali Menon, Nandana Varma, Aparna Nair,
  Sidharth Menon, Malavika Nair, Malavika Menon, Meera Nair, Meera Menon, Devika Nambiar, Aiswarya Menon, Basil Joseph, Keerthi Reddy,
  Sandeep Reddy, Bhavana Rao, Deepthi Reddy, Mounika Reddy, Kiran Kumar, Kiran Reddy, Lokesh Naidu, Nithin Kamath, Ananya Bhat,
  Kavya Shetty, Rakshitha Shetty, Archita Sahoo, Debasish Mohanty, Aamir Khan, Irfan Khan, Irfan Pathan, Zaid Khan, Zaid Ali,
  Danish Siddiqui, Danish Ali, Sana Khan, Zoya Akhtar, Fatima Shaikh, Fatima Sheikh, Arshad Warsi, Shoaib Akhtar, Shoaib Malik,
  Saniya Mirza, Anam Mirza, Mohammed Shahid, Farhan Akhtar, Hamza Ali, Junaid Khan, Saif Ali, Saif Khan, Ayesha Khan, Sadia Khan,
  Heena Khan, Uzma Khan, Bushra Ansari, Usman Khan, Ayaan Ali, Ankita Konwar, Debajit Saikia, Sonam Wangchuk, Jigme Wangchuk,
  Jigme Namgyal, Tashi Namgyal, Tashi Wangchuk, Ngawang Namgyal, Dawa Sherpa, Glen Saldanha, Brandon Fernandes, Faisal Shah,
  Faisal Malik, Shivani Raina, Siddharth Kaul, Vivek Razdan, Nikhil Advani, Aditya Srivastava, Kavya Gowda`));

const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
const pick = (r, a) => a[Math.floor(r() * a.length)];
const round2 = (x) => Math.round(x * 100) / 100;

function regionOf(r) {
  let x = r() * TOTAL_W;
  for (const g of REGIONS) { x -= g.w; if (x < 0) return g; }
  return REGIONS[0];
}

function drawName(r, gender) {
  for (;;) {
    const g = regionOf(r);
    let first, last;
    if (gender === 'M' && g.mohd && r() < g.mohd.p) { first = pick(r, g.mohd.first); last = pick(r, g.mohd.last); }
    else { first = pick(r, gender === 'F' ? g.f : g.m); last = pick(r, gender === 'F' ? g.lastF : g.lastM); }
    const name = `${first} ${last}`;
    if (!AVOID.has(name)) return { first, last, name };
  }
}

// female: share of girls in the batch (NEET intakes lean female, JEE intakes lean male).
const DEFS = [
  { id: 'neet-dropper-a', name: 'NEET Dropper · A', code: 'ND-A', exam: 'NEET', tpl: 'neet-mini', size: 68, time: [9, 30], female: 0.58 },
  { id: 'neet-xii-b', name: 'NEET XII · B', code: 'NX-B', exam: 'NEET', tpl: 'neet-mini', size: 61, time: [16, 0], female: 0.6 },
  { id: 'jee-xii-a', name: 'JEE XII · A', code: 'JX-A', exam: 'JEE', tpl: 'jee-mini', size: 72, time: [10, 0], female: 0.27 },
  { id: 'jee-dropper-b', name: 'JEE Dropper · B', code: 'JD-B', exam: 'JEE', tpl: 'jee-mini', size: 57, time: [14, 30], female: 0.23 },
];
const MOCK_DAYS_AGO = [23, 16, 9, 2];

function mockAt(daysAgo, [h, m]) {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Batches: { id, name, code, exam, tpl, size, mocks: [{ idx, name, at, seed }] }, mocks oldest first. */
export const BATCHES = DEFS.map((d) => ({
  id: d.id, name: d.name, code: d.code, exam: d.exam, tpl: d.tpl, size: d.size,
  mocks: MOCK_DAYS_AGO.map((ago, idx) => ({ idx, name: `Mock ${idx + 1}`, at: mockAt(ago, d.time), seed: hashStr(d.id + idx) })),
}));

/**
 * Students of one batch, in roll order. theta: ability (-1..1, batch-relative); trend: -1 declining,
 * 0 flat, 1 improving over the four mocks; style: how strain shows on their face (brow / lip press /
 * squint), stable across mocks. consent.behaviour: shares behaviour maps with the mentor;
 * consent.snapshots: allows a small photo when proctoring flags something.
 */
function makeStudents(d) {
  const r = rng(hashStr(`roster:${d.id}`));
  const taken = new Set();
  const out = [];
  for (let i = 1; i <= d.size; i++) {
    const gender = r() < d.female ? 'F' : 'M';
    let nm = drawName(r, gender);
    while (taken.has(nm.name)) nm = drawName(r, gender);
    taken.add(nm.name);
    const roll = `${d.code}-${String(i).padStart(3, '0')}`;
    const t = r();
    out.push({
      id: roll.toLowerCase(), first: nm.first, last: nm.last, name: nm.name, gender, roll,
      batchId: d.id, exam: d.exam, hue: Math.floor(r() * 360),
      consent: { behaviour: r() < 0.92, snapshots: r() < 0.8 },
      theta: round2(clamp(gauss(r) * 0.42, -1, 1)),
      trend: t < 0.14 ? -1 : t < 0.64 ? 0 : 1,
      style: { brow: round2(0.55 + r() * 0.2), press: round2(0.15 + r() * 0.2), squint: round2(0.1 + r() * 0.1) },
    });
  }
  return out;
}

/** batchId -> students */
export const ROSTER = new Map(DEFS.map((d) => [d.id, makeStudents(d)]));
export const ALL_STUDENTS = [...ROSTER.values()].flat();
export const batchById = (id) => BATCHES.find((b) => b.id === id) || null;
export const rosterOf = (batchId) => ROSTER.get(batchId) || [];
