/*

- store entities in shared memory entity arrays
- send entities in transit to other chunk's mailboxes
  - one mailbox for each sender-receiver pair
  - receiver reads new object, sets "free" flag
  - sender puts message in free object, removes "free" flag when done

- addressing entities currently residing in other chunks??
  - own chunk/other chunks?




Information that needs to be shared globally
- a lot for determining next state transition of person

*/